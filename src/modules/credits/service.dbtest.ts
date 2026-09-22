import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { eq, sql } from "drizzle-orm";

import { db, pool } from "../../db";
import { creditAccounts, creditLedger, creditUnlocks, subscriptions, user } from "../../db/schema";
import { env } from "../../env";
import { CREDIT_COSTS } from "./costs";
import { grantCredits, refundUnlock, spendCredits } from "./service";
import { CREDIT_CAP } from "./types";

/**
 * What the feature these tests spend on costs, read from the price list rather than
 * written down beside it.
 *
 * They are about the arithmetic, not about any one feature, and a fixture that hard-codes
 * a price fails the day the price moves — which is exactly how they broke when chat
 * stopped costing anything at all.
 */
const COST = CREDIT_COSTS.planetInsight;

/**
 * The double-spend guarantee is a property of Postgres re-evaluating a conditional
 * UPDATE against the new tuple after a lock is released. No amount of mocking
 * demonstrates that, so this suite runs against a real database — and therefore lives
 * outside `pnpm test` and the pre-commit hook. Run it with `pnpm test:db`.
 */

const enabled = process.env.RUN_DB_TESTS === "1" && env.CREDITS_ENFORCED;

/** Every user this suite makes, so they can all be removed at the end. */
const created: string[] = [];

async function makeUser(balance: number, anchorSecondsAgo = 0): Promise<string> {
    const id = `dbtest_${crypto.randomUUID()}`;

    await db.insert(user).values({
        id,
        name: "Credits db test",
        email: `${id}@dbtest.invalid`,
        emailVerified: false,
    });
    await db.insert(creditAccounts).values({
        userId: id,
        balance,
        balanceUpdatedAt: sql`now() - make_interval(secs => ${anchorSecondsAgo})`,
    });

    created.push(id);

    return id;
}

async function balanceOf(userId: string): Promise<number> {
    const [row] = await db
        .select({ balance: creditAccounts.balance })
        .from(creditAccounts)
        .where(eq(creditAccounts.userId, userId));

    return row.balance;
}

async function countRows(userId: string) {
    const unlocks = await db.select().from(creditUnlocks).where(eq(creditUnlocks.userId, userId));
    const ledger = await db.select().from(creditLedger).where(eq(creditLedger.userId, userId));

    return { unlocks: unlocks.length, ledger: ledger.length, ledgerSum: ledger.reduce((n, r) => n + r.delta, 0) };
}

describe(
    "spendCredits against a real database",
    { skip: enabled ? false : "set RUN_DB_TESTS=1 and CREDITS_ENFORCED=true" },
    () => {
        before(async () => {
            // Fail loudly rather than silently passing against an empty schema.
            await db.select().from(creditAccounts).limit(1);
        });

        after(async () => {
            for (const id of created) {
                await db.delete(user).where(eq(user.id, id));
            }

            await pool.end();
        });

        it("lets exactly one of twenty concurrent spends take what is left", async () => {
            const userId = await makeUser(COST);

            // Distinct resource keys, so the unlock index is not what serialises them —
            // only the conditional decrement is.
            const attempts = Array.from({ length: 20 }, (_, i) =>
                spendCredits(db, { userId, feature: "planetInsight", resourceKey: `race-${i}` })
            );

            const outcomes = await Promise.all(attempts);
            const charged = outcomes.filter((o) => o.ok && o.reason === "charged");
            const refused = outcomes.filter((o) => !o.ok);

            assert.equal(charged.length, 1, "one and only one spend may succeed");
            assert.equal(refused.length, 19);
            assert.equal(await balanceOf(userId), 0);

            const rows = await countRows(userId);
            assert.equal(rows.unlocks, 1, "the nineteen rolled-back attempts left no unlock behind");
            assert.equal(rows.ledger, 1);
            assert.equal(rows.ledgerSum, -1);
        });

        it("charges once when twenty requests race the same resource", async () => {
            const userId = await makeUser(CREDIT_CAP);

            const outcomes = await Promise.all(
                Array.from({ length: 20 }, () =>
                    spendCredits(db, { userId, feature: "dailyInsight", resourceKey: "2026-09-10" })
                )
            );

            const charged = outcomes.filter((o) => o.ok && o.reason === "charged");
            const already = outcomes.filter((o) => o.ok && o.reason === "already_unlocked");

            assert.equal(charged.length, 1);
            assert.equal(already.length, 19, "the rest attach to the unlock rather than paying again");
            assert.equal(await balanceOf(userId), CREDIT_CAP - 5);

            const rows = await countRows(userId);
            assert.equal(rows.unlocks, 1);
            assert.equal(rows.ledger, 1);
        });

        it("leaves nothing behind when the debit cannot afford it", async () => {
            const userId = await makeUser(2);

            const outcome = await spendCredits(db, { userId, feature: "dailyInsight", resourceKey: "2026-09-11" });

            assert.equal(outcome.ok, false);
            assert.equal(await balanceOf(userId), 2, "the balance is untouched");

            const rows = await countRows(userId);
            assert.equal(rows.unlocks, 0, "the rollback took the unlock with it");
            assert.equal(rows.ledger, 0);
        });

        it("never touches the balance of a subscriber", async () => {
            const userId = await makeUser(3);

            await db.insert(subscriptions).values({
                userId,
                status: "active",
                expiresAt: sql`now() + interval '30 days'`,
                productId: "com.danielkrejci.lunii.super.monthly",
                store: "APP_STORE",
                environment: "PRODUCTION",
                lastEventAt: sql`now()`,
            });

            const outcome = await spendCredits(db, { userId, feature: "dailyInsight", resourceKey: "2026-09-12" });

            assert.equal(outcome.ok, true);
            assert.equal(outcome.ok && outcome.reason, "subscription");
            assert.equal(await balanceOf(userId), 3, "three credits, and still three");

            const rows = await countRows(userId);
            assert.equal(rows.ledger, 0, "nothing is written for a reader who is not counted");
        });

        it("still entitles a subscriber who cancelled but has not yet expired", async () => {
            const userId = await makeUser(0);

            await db.insert(subscriptions).values({
                userId,
                status: "canceled",
                expiresAt: sql`now() + interval '10 days'`,
                productId: "com.danielkrejci.lunii.super.monthly",
                store: "APP_STORE",
                environment: "PRODUCTION",
                willRenew: false,
                lastEventAt: sql`now()`,
            });

            const outcome = await spendCredits(db, { userId, feature: "dailyInsight", resourceKey: "2026-09-13" });

            assert.equal(outcome.ok && outcome.reason, "subscription", "auto-renew off is not the same as expired");
        });

        it("stops entitling once the subscription has expired", async () => {
            const userId = await makeUser(0);

            await db.insert(subscriptions).values({
                userId,
                status: "canceled",
                expiresAt: sql`now() - interval '1 day'`,
                productId: "com.danielkrejci.lunii.super.monthly",
                store: "APP_STORE",
                environment: "PRODUCTION",
                willRenew: false,
                lastEventAt: sql`now()`,
            });

            const outcome = await spendCredits(db, { userId, feature: "dailyInsight", resourceKey: "2026-09-14" });

            assert.equal(outcome.ok, false, "and with no credits, the reader is refused");
        });

        it("refunds once when two callers race the same refund", async () => {
            const userId = await makeUser(CREDIT_CAP);

            await spendCredits(db, { userId, feature: "dailyInsight", resourceKey: "2026-09-15" });
            assert.equal(await balanceOf(userId), CREDIT_CAP - 5);

            const refunds = await Promise.all([
                refundUnlock(db, { userId, feature: "dailyInsight", resourceKey: "2026-09-15" }),
                refundUnlock(db, { userId, feature: "dailyInsight", resourceKey: "2026-09-15" }),
            ]);

            assert.deepEqual(
                [...refunds].sort((a, b) => a - b),
                [0, 5],
                "one gives back five, the other nothing"
            );
            assert.equal(await balanceOf(userId), CREDIT_CAP, "made whole, and not more than whole");

            const rows = await countRows(userId);
            assert.equal(rows.unlocks, 0, "the unlock is revoked, so a retry pays again");
            assert.equal(rows.ledgerSum, 0);
        });

        it("gives credits back above the cap rather than confiscating the difference", async () => {
            // A reader who bought a pack, spent from it, and then had the generation fail.
            const userId = await makeUser(CREDIT_CAP + 10);

            await spendCredits(db, { userId, feature: "dailyInsight", resourceKey: "2026-09-16" });
            assert.equal(await balanceOf(userId), CREDIT_CAP + 5);

            await refundUnlock(db, { userId, feature: "dailyInsight", resourceKey: "2026-09-16" });
            assert.equal(
                await balanceOf(userId),
                CREDIT_CAP + 10,
                "clamping the way back would be a partial confiscation"
            );
        });

        it("grants a bought pack once, however many times it is delivered", async () => {
            const userId = await makeUser(4);
            const key = `store-txn-${crypto.randomUUID()}`;

            const results = await Promise.all([
                grantCredits(db, { userId, amount: 60, reason: "purchase", idempotencyKey: key }),
                grantCredits(db, { userId, amount: 60, reason: "purchase", idempotencyKey: key }),
            ]);

            assert.equal(results.filter((r) => r.granted).length, 1, "the webhook and /sync must not both pay out");
            assert.equal(await balanceOf(userId), 64);
        });

        it("floors a clawback at zero rather than putting a reader in debt", async () => {
            const userId = await makeUser(5);

            await grantCredits(db, {
                userId,
                amount: -60,
                reason: "purchase_refund",
                idempotencyKey: `refund-${crypto.randomUUID()}`,
            });

            assert.equal(await balanceOf(userId), 0);
        });

        it("accrues while spending, so a wallet left alone pays for the next thing", async () => {
            // Emptied a while ago: one credit more than the spend is owed by now.
            const userId = await makeUser(0, (COST + 1) * 3600);

            const outcome = await spendCredits(db, {
                userId,
                feature: "planetInsight",
                resourceKey: crypto.randomUUID(),
            });

            assert.equal(outcome.ok && outcome.reason, "charged");
            assert.equal(await balanceOf(userId), 1, "one more accrued than was spent");
        });

        it("reconciles: the balance is the opening grant plus every ledger row", async () => {
            const userId = await makeUser(CREDIT_CAP);

            await spendCredits(db, { userId, feature: "dailyInsight", resourceKey: "2026-09-17" });
            await spendCredits(db, { userId, feature: "moonInsight", resourceKey: "2026-09-17" });
            await spendCredits(db, { userId, feature: "planetInsight", resourceKey: crypto.randomUUID() });
            await refundUnlock(db, { userId, feature: "moonInsight", resourceKey: "2026-09-17" });
            await grantCredits(db, {
                userId,
                amount: 25,
                reason: "purchase",
                idempotencyKey: `recon-${crypto.randomUUID()}`,
            });

            const rows = await countRows(userId);

            assert.equal(await balanceOf(userId), CREDIT_CAP + rows.ledgerSum);
        });
    }
);
