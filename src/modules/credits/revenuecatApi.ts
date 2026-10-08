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

const ORIGIN = "https://api.revenuecat.com";
const BASE_PATH = "/v2";

/** The largest page the v2 lists accept, so a typical customer is one request. */
const PAGE_SIZE = 100;

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
 * Cached for an hour because it changes only when a product is added — and an id the
 * map does not know refreshes it on the spot, so a new pack still works the minute it
 * exists. The promise is what is cached, not the map: a sync asks for it twice at
 * once, and both callers share the one request instead of each starting their own.
 */
let productMap: { at: number; byId: Promise<Map<string, string>> } | null = null;

const PRODUCT_MAP_TTL_MS = 60 * 60_000;

function storeIdentifiers(options: { refresh?: boolean } = {}): Promise<Map<string, string>> {
    if (!options.refresh && productMap && Date.now() - productMap.at < PRODUCT_MAP_TTL_MS) {
        return productMap.byId;
    }

    const byId = getAll(`/projects/${env.REVENUECAT_PROJECT_ID}/products`).then((items) => {
        const map = new Map<string, string>();

        for (const item of items) {
            const id = typeof item.id === "string" ? item.id : null;
            const storeIdentifier = typeof item.store_identifier === "string" ? item.store_identifier : null;

            if (id && storeIdentifier) {
                map.set(id, storeIdentifier);
            }
        }

        return map;
    });

    const entry = { at: Date.now(), byId };

    productMap = entry;

    // A failed fetch must not be served for the next hour.
    byId.catch(() => {
        if (productMap === entry) {
            productMap = null;
        }
    });

    return byId;
}

/** The map, refreshed once if it does not know every id it is about to be asked for. */
async function storeIdentifiersFor(productIds: string[]): Promise<Map<string, string>> {
    const byId = await storeIdentifiers();

    if (productIds.every((id) => id.length === 0 || byId.has(id))) {
        return byId;
    }

    return storeIdentifiers({ refresh: true });
}

async function get(path: string): Promise<unknown> {
    const response = await fetch(new URL(path, ORIGIN), {
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

/** A ceiling on pages, so a cursor that never ends cannot hold a sync open forever. */
const MAX_PAGES = 10;

/**
 * Every item of a v2 list, across pages.
 *
 * The lists are cursor-paged, and the order of items is not documented — so reading
 * only the first page could miss the purchase that was just made, once a customer has
 * more than a page of them. `next_page` is a path from the origin, `/v2/...` included.
 */
async function getAll(path: string): Promise<Record<string, unknown>[]> {
    const items: Record<string, unknown>[] = [];
    let next: string | null = `${BASE_PATH}${path}${path.includes("?") ? "&" : "?"}limit=${PAGE_SIZE}`;

    for (let page = 0; next !== null && page < MAX_PAGES; page += 1) {
        const body = (await get(next)) as { items?: Record<string, unknown>[]; next_page?: string | null };

        items.push(...(body.items ?? []));
        next = typeof body.next_page === "string" && body.next_page.length > 0 ? body.next_page : null;
    }

    return items;
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
    const [items] = await Promise.all([
        getAll(`/projects/${env.REVENUECAT_PROJECT_ID}/customers/${encodeURIComponent(appUserId)}/subscriptions`),
        // Warmed alongside, so the common case still costs no extra wait.
        storeIdentifiers(),
    ]);
    const byId = await storeIdentifiersFor(items.map((item) => String(item.product_id ?? "")));

    return items
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
    const [items] = await Promise.all([
        getAll(`/projects/${env.REVENUECAT_PROJECT_ID}/customers/${encodeURIComponent(appUserId)}/purchases`),
        // Warmed alongside, so the common case still costs no extra wait.
        storeIdentifiers(),
    ]);
    const byId = await storeIdentifiersFor(items.map((item) => String(item.product_id ?? "")));

    return items
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
