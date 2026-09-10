import { env } from "../../env";
import { CREDIT_PACKS, SUBSCRIPTION_PRODUCT_IDS } from "./costs";
import { SubscriptionStatus } from "./types";

/**
 * Reading RevenueCat rather than waiting to be told.
 *
 * The webhook is the durable path and this is the fallback: a delivery can be late by
 * tens of seconds, and it can be lost. Without a pull, a reader who has just paid
 * stares at the paywall they paid to remove and there is nothing either side can do.
 *
 * Everything here is read-only and server-side. A client is never trusted with a
 * receipt or an entitlement — `/api/credits/sync` takes only an app user id.
 */

const BASE_URL = "https://api.revenuecat.com/v2";

/** Beyond this the caller is better off with the webhook it already has. */
const TIMEOUT_MS = 5000;

export interface RemoteSubscription {
    status: SubscriptionStatus;
    expiresAt: Date | null;
    productId: string;
    store: string;
    environment: "PRODUCTION" | "SANDBOX";
    willRenew: boolean;
    /** RevenueCat's own last-modified, used as the ordering guard. */
    at: Date;
}

export interface RemotePurchase {
    /** The store transaction — the same key the webhook grants on, so the two agree. */
    transactionId: string;
    productId: string;
    credits: number;
    environment: "PRODUCTION" | "SANDBOX";
}

/**
 * RevenueCat's subscription states, in ours.
 *
 * `in_grace_period` and `in_billing_retry` still entitle: Apple has not been paid but
 * the reader has not lost anything yet. `trialing` is active — there is no trial on
 * these products today, but reading it as inactive would be a silent bug the day one
 * is added.
 */
function toStatus(remote: string | undefined, autoRenew: string | undefined): SubscriptionStatus {
    switch (remote) {
        case "trialing":
        case "active":
            return autoRenew === "off" || autoRenew === "will_not_renew" ? "canceled" : "active";
        case "in_grace_period":
        case "in_billing_retry":
            return "billing_issue";
        case "paused":
            return "paused";
        case "expired":
            return "expired";
        default:
            return "expired";
    }
}

/**
 * RevenueCat's internal product ids, mapped to the store identifiers everything else
 * here is keyed by.
 *
 * This translation is the whole reason this file is more than two fetches. The v2 REST
 * API reports `product_id` as its OWN id — `prod146d013453` — while the webhook reports
 * the same product as `com.danielkrejci.lunii.credits.60`. Looking the REST value up in
 * `CREDIT_PACKS` therefore matches nothing, silently: the purchase is filtered out as
 * "not a pack we know", and the reader never gets their credits.
 *
 * Cached because it changes only when a product is added, and a sync should not spend a
 * round trip on it every time.
 */
let productMap: { at: number; byId: Map<string, string> } | null = null;

const PRODUCT_MAP_TTL_MS = 10 * 60_000;

async function storeIdentifiers(): Promise<Map<string, string>> {
    if (productMap && Date.now() - productMap.at < PRODUCT_MAP_TTL_MS) {
        return productMap.byId;
    }

    const body = (await get(`/projects/${env.REVENUECAT_PROJECT_ID}/products?limit=100`)) as {
        items?: Record<string, unknown>[];
    };

    const byId = new Map<string, string>();

    for (const item of body.items ?? []) {
        const id = typeof item.id === "string" ? item.id : null;
        const storeIdentifier = typeof item.store_identifier === "string" ? item.store_identifier : null;

        if (id && storeIdentifier) {
            byId.set(id, storeIdentifier);
        }
    }

    productMap = { at: Date.now(), byId };

    return byId;
}

async function get(path: string): Promise<unknown> {
    const response = await fetch(`${BASE_URL}${path}`, {
        headers: {
            authorization: `Bearer ${env.REVENUECAT_API_KEY}`,
            accept: "application/json",
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
        throw new Error(`RevenueCat ${path} responded ${response.status}`);
    }

    return response.json();
}

function toDate(value: unknown): Date | null {
    if (typeof value === "number" && Number.isFinite(value)) {
        return new Date(value);
    }

    if (typeof value === "string") {
        const parsed = Date.parse(value);

        return Number.isNaN(parsed) ? null : new Date(parsed);
    }

    return null;
}

function toEnvironment(value: unknown): "PRODUCTION" | "SANDBOX" {
    return typeof value === "string" && value.toLowerCase() === "sandbox" ? "SANDBOX" : "PRODUCTION";
}

/** Every subscription RevenueCat holds for this customer. */
export async function fetchSubscriptions(appUserId: string): Promise<RemoteSubscription[]> {
    const [body, byId] = await Promise.all([
        get(
            `/projects/${env.REVENUECAT_PROJECT_ID}/customers/${encodeURIComponent(appUserId)}/subscriptions`
        ) as Promise<{ items?: Record<string, unknown>[] }>,
        storeIdentifiers(),
    ]);

    return (body.items ?? [])
        .map((item) => {
            // Translated, not read directly — see `storeIdentifiers`.
            const productId = byId.get(String(item.product_id ?? "")) ?? "";

            return {
                status: toStatus(item.status as string | undefined, item.auto_renewal_status as string | undefined),
                expiresAt: toDate(item.current_period_ends_at),
                productId,
                store: String(item.store ?? "UNKNOWN").toUpperCase(),
                environment: toEnvironment(item.environment),
                willRenew: item.auto_renewal_status === "will_renew",
                at: toDate(item.current_period_starts_at) ?? new Date(),
            };
        })
        .filter((subscription) => SUBSCRIPTION_PRODUCT_IDS.has(subscription.productId));
}

/** Every consumable RevenueCat holds for this customer that we know how to price. */
export async function fetchPurchases(appUserId: string): Promise<RemotePurchase[]> {
    const [body, byId] = await Promise.all([
        get(`/projects/${env.REVENUECAT_PROJECT_ID}/customers/${encodeURIComponent(appUserId)}/purchases`) as Promise<{
            items?: Record<string, unknown>[];
        }>,
        storeIdentifiers(),
    ]);

    return (body.items ?? [])
        .map((item) => {
            // Translated, not read directly — see `storeIdentifiers`.
            const productId = byId.get(String(item.product_id ?? "")) ?? "";

            return {
                transactionId: String(item.store_purchase_identifier ?? item.id ?? ""),
                productId,
                credits: CREDIT_PACKS[productId] ?? 0,
                environment: toEnvironment(item.environment),
            };
        })
        .filter((purchase) => purchase.credits > 0 && purchase.transactionId.length > 0);
}
