import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { candidateAppUserIds, interpretEvent, isAnonymousAppUserId, RevenuecatEvent } from "./revenuecat";

const NOW_MS = Date.parse("2026-09-10T12:00:00.000Z");
const EXPIRY_MS = Date.parse("2026-10-10T12:00:00.000Z");

function event(overrides: Partial<RevenuecatEvent> & { type: string }): RevenuecatEvent {
    return {
        id: `evt_${overrides.type}`,
        app_user_id: "user_1",
        environment: "PRODUCTION",
        store: "APP_STORE",
        event_timestamp_ms: NOW_MS,
        ...overrides,
    };
}

const live = { allowSandbox: false };

describe("interpretEvent", () => {
    it("treats an ordinary cancellation as auto-renew off, not as a revocation", () => {
        const intent = interpretEvent(
            event({
                type: "CANCELLATION",
                cancel_reason: "UNSUBSCRIBE",
                product_id: "com.danielkrejci.lunii.super.monthly",
                expiration_at_ms: EXPIRY_MS,
            }),
            live
        );

        assert.equal(intent.kind, "subscription");
        assert.equal(intent.kind === "subscription" && intent.status, "canceled");
        assert.equal(
            intent.kind === "subscription" && intent.expiresAt?.getTime(),
            EXPIRY_MS,
            "the month they paid for is still theirs"
        );
        assert.equal(intent.kind === "subscription" && intent.willRenew, false);
    });

    it("ends entitlement immediately when support refunds a subscription", () => {
        const intent = interpretEvent(
            event({
                type: "CANCELLATION",
                cancel_reason: "CUSTOMER_SUPPORT",
                product_id: "com.danielkrejci.lunii.super.monthly",
                expiration_at_ms: EXPIRY_MS,
            }),
            live
        );

        assert.equal(intent.kind === "subscription" && intent.status, "refunded");
        assert.equal(intent.kind === "subscription" && intent.expiresAt?.getTime(), NOW_MS);
    });

    it("keeps a reader entitled through a billing grace period", () => {
        const grace = Date.parse("2026-09-25T12:00:00.000Z");
        const intent = interpretEvent(
            event({
                type: "BILLING_ISSUE",
                product_id: "com.danielkrejci.lunii.super.monthly",
                expiration_at_ms: EXPIRY_MS,
                grace_period_expiration_at_ms: grace,
            }),
            live
        );

        assert.equal(intent.kind === "subscription" && intent.status, "billing_issue");
        assert.equal(intent.kind === "subscription" && intent.expiresAt?.getTime(), grace);
    });

    it("grants a known pack, keyed on the store transaction rather than the event", () => {
        const intent = interpretEvent(
            event({
                type: "NON_RENEWING_PURCHASE",
                product_id: "com.danielkrejci.lunii.credits.60",
                transaction_id: "txn_abc",
            }),
            live
        );

        assert.equal(intent.kind, "grant");
        assert.equal(intent.kind === "grant" && intent.amount, 60);
        assert.equal(
            intent.kind === "grant" && intent.idempotencyKey,
            "purchase:txn_abc",
            "a redelivery under a new event id must still be one grant"
        );
    });

    it("refuses an unknown product rather than granting zero", () => {
        // Granting zero would write an idempotency row, and the correct grant after a
        // config fix would then be swallowed as a duplicate.
        const intent = interpretEvent(
            event({ type: "NON_RENEWING_PURCHASE", product_id: "com.danielkrejci.lunii.credits.999" }),
            live
        );

        assert.equal(intent.kind, "ignore");
    });

    it("claws a refunded pack back", () => {
        const intent = interpretEvent(
            event({
                type: "CANCELLATION",
                cancel_reason: "CUSTOMER_SUPPORT",
                product_id: "com.danielkrejci.lunii.credits.25",
                transaction_id: "txn_xyz",
            }),
            live
        );

        assert.equal(intent.kind, "grant");
        assert.equal(intent.kind === "grant" && intent.amount, -25);
        assert.equal(intent.kind === "grant" && intent.idempotencyKey, "refund:txn_xyz");
    });

    it("does not confuse a pack clawback with a subscription refund", () => {
        const pack = interpretEvent(
            event({ type: "CANCELLATION", product_id: "com.danielkrejci.lunii.credits.25", transaction_id: "t1" }),
            live
        );
        const sub = interpretEvent(
            event({ type: "CANCELLATION", product_id: "com.danielkrejci.lunii.super.monthly" }),
            live
        );

        assert.equal(pack.kind, "grant");
        assert.equal(sub.kind, "subscription");
    });

    it("ignores sandbox in production and honours it when allowed", () => {
        const sandbox = event({
            type: "INITIAL_PURCHASE",
            environment: "SANDBOX",
            product_id: "com.danielkrejci.lunii.super.monthly",
            expiration_at_ms: EXPIRY_MS,
        });

        assert.equal(interpretEvent(sandbox, live).kind, "ignore");
        assert.equal(interpretEvent(sandbox, { allowSandbox: true }).kind, "subscription");
    });

    it("activates on every event that means the subscription is running", () => {
        for (const type of [
            "INITIAL_PURCHASE",
            "RENEWAL",
            "UNCANCELLATION",
            "SUBSCRIPTION_EXTENDED",
            "PRODUCT_CHANGE",
        ]) {
            const intent = interpretEvent(
                event({ type, product_id: "com.danielkrejci.lunii.super.monthly", expiration_at_ms: EXPIRY_MS }),
                live
            );

            assert.equal(intent.kind === "subscription" && intent.status, "active", type);
        }
    });

    it("expires, and falls back to the event's own clock when no expiry is given", () => {
        const intent = interpretEvent(event({ type: "EXPIRATION" }), live);

        assert.equal(intent.kind === "subscription" && intent.status, "expired");
        assert.equal(intent.kind === "subscription" && intent.expiresAt?.getTime(), NOW_MS);
    });

    it("reads a transfer's two sides", () => {
        const intent = interpretEvent(
            event({ type: "TRANSFER", transferred_from: ["old"], transferred_to: ["new"] }),
            live
        );

        assert.deepEqual(intent, { kind: "transfer", from: ["old"], to: ["new"] });
    });

    it("ignores a test event and anything it has never heard of", () => {
        assert.equal(interpretEvent(event({ type: "TEST" }), live).kind, "ignore");
        assert.equal(interpretEvent(event({ type: "INVOICE_ISSUANCE" }), live).kind, "ignore");
    });
});

describe("candidateAppUserIds", () => {
    it("lists every id the buyer might be known by, without repeats", () => {
        const ids = candidateAppUserIds(
            event({ type: "TEST", app_user_id: "a", original_app_user_id: "b", aliases: ["a", "c"] })
        );

        assert.deepEqual(ids, ["a", "b", "c"]);
    });

    it("drops empty and missing ids", () => {
        const ids = candidateAppUserIds(
            event({ type: "TEST", app_user_id: "a", original_app_user_id: null, aliases: [""] })
        );

        assert.deepEqual(ids, ["a"]);
    });
});

describe("isAnonymousAppUserId", () => {
    it("recognises RevenueCat's own anonymous ids", () => {
        assert.equal(isAnonymousAppUserId("$RCAnonymousID:6a1c"), true);
        assert.equal(isAnonymousAppUserId("cRLiOHKtoc6Gzill"), false);
    });
});
