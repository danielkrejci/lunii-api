import { CREDIT_PACKS, SUBSCRIPTION_PRODUCT_IDS } from "./costs";
import { SubscriptionStatus } from "./types";

/**
 * Turning a RevenueCat webhook into an intention, and nothing else.
 *
 * Pure on purpose. Most of the risk in a store integration is in reading the payload —
 * a cancellation that is not a revocation, a refund that arrives as a cancellation, an
 * event delivered out of order — and none of that needs a database to get wrong. The
 * database half lives in `revenuecatApply.ts`, which does what this decides.
 */

/** The subset of RevenueCat's payload this reads. Loose: they add fields. */
export interface RevenuecatEvent {
    id: string;
    type: string;
    app_user_id: string;
    original_app_user_id?: string | null;
    aliases?: string[] | null;
    product_id?: string | null;
    store?: string | null;
    environment?: string | null;
    event_timestamp_ms?: number | null;
    purchased_at_ms?: number | null;
    expiration_at_ms?: number | null;
    grace_period_expiration_at_ms?: number | null;
    auto_resume_at_ms?: number | null;
    cancel_reason?: string | null;
    transaction_id?: string | null;
    original_transaction_id?: string | null;
    transferred_from?: string[] | null;
    transferred_to?: string[] | null;
    [key: string]: unknown;
}

export type EventIntent =
    /** Understood, and deliberately nothing to do. */
    | { kind: "ignore"; reason: string }
    | {
          kind: "subscription";
          status: SubscriptionStatus;
          /** What actually ends entitlement. Null only if the store sent no expiry. */
          expiresAt: Date | null;
          productId: string;
          store: string;
          environment: "PRODUCTION" | "SANDBOX";
          willRenew: boolean;
      }
    /** A consumable pack. `amount` is signed: negative is Apple taking one back. */
    | { kind: "grant"; amount: number; idempotencyKey: string; productId: string }
    | { kind: "transfer"; from: string[]; to: string[] };

/**
 * Cancellations that are a refund rather than a decision not to renew.
 *
 * The distinction is the whole reason `CANCELLATION` is not simply a revocation:
 * pressing cancel in the App Store leaves the reader entitled until the period ends,
 * and treating that as an expiry takes away a month they paid for.
 */
const REFUND_REASONS = new Set(["CUSTOMER_SUPPORT", "DEVELOPER_INITIATED"]);

function toDate(ms: number | null | undefined): Date | null {
    return typeof ms === "number" && Number.isFinite(ms) ? new Date(ms) : null;
}

/** When this happened, by the store's clock. Arrival order means nothing. */
export function eventTimestamp(event: RevenuecatEvent): Date {
    return toDate(event.event_timestamp_ms) ?? new Date();
}

export function eventEnvironment(event: RevenuecatEvent): "PRODUCTION" | "SANDBOX" {
    return event.environment === "SANDBOX" ? "SANDBOX" : "PRODUCTION";
}

export function interpretEvent(event: RevenuecatEvent, options: { allowSandbox: boolean }): EventIntent {
    const environment = eventEnvironment(event);

    /**
     * A sandbox purchase is a real row in RevenueCat and a fake one everywhere else. In
     * production it must grant nothing, or a TestFlight tester with a five-minute
     * subscription becomes a subscriber in real data.
     */
    if (environment === "SANDBOX" && !options.allowSandbox) {
        return { kind: "ignore", reason: "sandbox" };
    }

    const productId = event.product_id ?? "";
    const store = event.store ?? "UNKNOWN";

    switch (event.type) {
        case "TEST":
            return { kind: "ignore", reason: "test event" };

        case "TRANSFER":
            return {
                kind: "transfer",
                from: event.transferred_from ?? [],
                to: event.transferred_to ?? [],
            };

        case "NON_RENEWING_PURCHASE": {
            const amount = CREDIT_PACKS[productId];

            /**
             * Granting zero for an unknown product would be worse than refusing: it
             * writes an idempotency row, so the correct grant that follows a config fix
             * would then be swallowed as a duplicate.
             */
            if (amount === undefined) {
                return { kind: "ignore", reason: `unknown product ${productId}` };
            }

            return {
                kind: "grant",
                amount,
                /**
                 * The store's transaction, not the event. A redelivery under a fresh
                 * event id is the exact case this has to survive.
                 */
                idempotencyKey: `purchase:${event.transaction_id ?? event.id}`,
                productId,
            };
        }

        case "INITIAL_PURCHASE":
        case "RENEWAL":
        case "UNCANCELLATION":
        case "SUBSCRIPTION_EXTENDED":
        case "PRODUCT_CHANGE":
            return {
                kind: "subscription",
                status: "active",
                expiresAt: toDate(event.expiration_at_ms),
                productId,
                store,
                environment,
                willRenew: true,
            };

        case "CANCELLATION": {
            const refunded = REFUND_REASONS.has(event.cancel_reason ?? "");

            /**
             * A refunded consumable. RevenueCat reports it as a cancellation of the
             * non-renewing purchase, so it is told apart by the product rather than by
             * the event type.
             */
            if (!SUBSCRIPTION_PRODUCT_IDS.has(productId) && CREDIT_PACKS[productId] !== undefined) {
                return {
                    kind: "grant",
                    amount: -CREDIT_PACKS[productId],
                    idempotencyKey: `refund:${event.transaction_id ?? event.id}`,
                    productId,
                };
            }

            return {
                kind: "subscription",
                // A refund ends it now; an ordinary cancel only stops the next charge.
                status: refunded ? "refunded" : "canceled",
                expiresAt: refunded ? eventTimestamp(event) : toDate(event.expiration_at_ms),
                productId,
                store,
                environment,
                willRenew: false,
            };
        }

        case "BILLING_ISSUE":
            return {
                kind: "subscription",
                status: "billing_issue",
                // Entitled through the grace period, which is the point of having one.
                expiresAt: toDate(event.grace_period_expiration_at_ms) ?? toDate(event.expiration_at_ms),
                productId,
                store,
                environment,
                willRenew: true,
            };

        case "SUBSCRIPTION_PAUSED":
            return {
                kind: "subscription",
                status: "paused",
                // Entitled to the end of the period already paid for, then not.
                expiresAt: toDate(event.expiration_at_ms),
                productId,
                store,
                environment,
                willRenew: true,
            };

        case "EXPIRATION":
            return {
                kind: "subscription",
                status: "expired",
                expiresAt: toDate(event.expiration_at_ms) ?? eventTimestamp(event),
                productId,
                store,
                environment,
                willRenew: false,
            };

        default:
            return { kind: "ignore", reason: `unhandled type ${event.type}` };
    }
}

/**
 * Every id RevenueCat might know this buyer by, most specific first.
 *
 * The client calls `Purchases.logIn(user.id)`, so the first is normally ours — but a
 * purchase made before that call lands under an anonymous id, and RevenueCat keeps
 * both as aliases of one customer.
 */
export function candidateAppUserIds(event: RevenuecatEvent): string[] {
    const ids = [event.app_user_id, event.original_app_user_id, ...(event.aliases ?? [])];

    return [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))];
}

/** RevenueCat's own anonymous ids, which are never one of our user ids. */
export function isAnonymousAppUserId(appUserId: string): boolean {
    return appUserId.startsWith("$RCAnonymousID:");
}
