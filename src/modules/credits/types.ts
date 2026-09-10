/**
 * The vocabulary the credit system is built from.
 *
 * Deliberately free of imports: `db/schema` reads its column types from here, so
 * anything this module pulled back in would close a cycle — the same arrangement
 * `modules/chat/types.ts` describes.
 *
 * Every union is exported as a value as well as a type, so a route schema validates
 * against the same list the column is narrowed to rather than a second copy of it.
 */

/**
 * Everything that can be bought with credits.
 *
 * `chatMessage` sits here with the rest even though nothing "unlocks" for a reader to
 * come back to. A paid send is still a one-time purchase keyed by the client's own id,
 * and treating it exactly like the others is what makes a retried POST — a dropped
 * socket, a backgrounded app — free rather than charged twice.
 */
export const CREDIT_FEATURES = [
    "dailyInsight",
    "moonInsight",
    "planetInsight",
    "compatibilityDetail",
    "chatMessage",
] as const;

export type CreditFeature = (typeof CREDIT_FEATURES)[number];

/**
 * Why a ledger row exists.
 *
 * The sign of `delta` is derivable; the intent behind it is not. A `-5` could be a
 * spend or a clawback on a refunded pack, and only one of those is the reader's doing.
 */
export const CREDIT_LEDGER_REASONS = [
    /** The credits every account is opened with. */
    "initial_grant",
    "spend",
    /** A generation that never arrived, given back. */
    "refund",
    /** A consumable pack, from RevenueCat. */
    "purchase",
    /** Apple took the pack back. */
    "purchase_refund",
    "admin",
] as const;

export type CreditLedgerReason = (typeof CREDIT_LEDGER_REASONS)[number];

/**
 * Entitlement state, in our words rather than RevenueCat's.
 *
 * `canceled` is not `expired`, and conflating them is the easiest way to take a paid
 * month away on the day someone pressed cancel: turning off auto-renew is a fact about
 * the next charge, not about today. Only `expires_at` ends a subscription.
 */
export const SUBSCRIPTION_STATUSES = [
    "active",
    /** Auto-renew is off. Still entitled until `expires_at`. */
    "canceled",
    /** Apple could not charge. Entitled through the grace period. */
    "billing_issue",
    "paused",
    "expired",
    /** Refunded by Apple or by support. Entitlement ends immediately. */
    "refunded",
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** What a webhook delivery ended up being. */
export const REVENUECAT_EVENT_STATUSES = [
    "processed",
    /** Understood and deliberately not acted on — a test event, a sandbox purchase. */
    "ignored",
    /** The buyer could not be matched to a user yet. Parked, and replayed by `/sync`. */
    "unmapped",
    "failed",
] as const;

export type RevenuecatEventStatus = (typeof REVENUECAT_EVENT_STATUSES)[number];

/**
 * The ceiling regeneration fills to.
 *
 * Not a ceiling on the balance itself: a bought pack may leave a reader above this, and
 * regeneration then simply does nothing until they spend back down. See `accrual.ts`.
 */
export const CREDIT_CAP = 24;

/** One credit per hour. */
export const CREDIT_REGEN_SECONDS = 3600;
