import { CREDIT_FEATURES, CreditFeature } from "./types";

/**
 * What each thing costs, and the one place a price is written.
 *
 * Deliberately code rather than a table. A price change is a release: it belongs in the
 * diff next to whatever else moved with it, and a row nobody can see is a bad place to
 * keep the number that decides whether a reader can open their horoscope.
 *
 * The client never compiles in a copy — every response that can be bought carries its
 * own `cost`, and `GET /api/credits/state` carries the whole table, so these can change
 * without an app update.
 */
export const CREDIT_COSTS = {
    dailyInsight: 5,
    moonInsight: 5,
    planetInsight: 1,
    compatibilityDetail: 5,
    chatMessage: 1,
} as const satisfies Record<CreditFeature, number>;

/**
 * What a consumable pack is worth, by App Store product id.
 *
 * A product id that is not in here grants nothing and logs an error — the safe failure,
 * but a silent one, so these must match App Store Connect exactly.
 */
export const CREDIT_PACKS: Record<string, number> = {
    "com.danielkrejci.lunii.credits.25": 25,
    "com.danielkrejci.lunii.credits.60": 60,
    "com.danielkrejci.lunii.credits.150": 150,
};

/** Product ids that grant unlimited credits while entitled. */
export const SUBSCRIPTION_PRODUCT_IDS = new Set(["com.danielkrejci.lunii.super.monthly"]);

/**
 * The RevenueCat entitlement the subscription products are attached to.
 *
 * `lunii_super` is the lookup key as it actually exists in the dashboard. Nothing here
 * gates on it today — entitlement is decided from the `subscriptions` table, which the
 * webhook and the sync both write — but a wrong value would be a trap for whoever
 * reaches for it first.
 */
export const ENTITLEMENT_ID = "lunii_super";

/**
 * The pack catalogue, for the client.
 *
 * The app must not decide what counts as a credit pack. RevenueCat's offering also
 * carries the subscription — and, depending on the dashboard, a yearly and a lifetime
 * one — and a client that treated "anything that is not monthly" as a pack would
 * cheerfully offer a subscription as if it granted credits.
 *
 * Sent smallest first, so the paywall's order is decided here rather than by parsing
 * store titles.
 */
export const CREDIT_PACK_CATALOGUE: { productId: string; credits: number }[] = Object.entries(CREDIT_PACKS)
    .map(([productId, credits]) => ({ productId, credits }))
    .sort((a, b) => a.credits - b.credits);

export function costOf(feature: CreditFeature): number {
    return CREDIT_COSTS[feature];
}

/** The whole price list, in the shape the client is handed it. */
export const ALL_COSTS: Record<CreditFeature, number> = Object.fromEntries(
    CREDIT_FEATURES.map((feature) => [feature, CREDIT_COSTS[feature]])
) as Record<CreditFeature, number>;
