import { and, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { FastifyInstance } from "fastify";

import { creditAccounts, creditLedger, creditUnlocks, subscriptions } from "../../db/schema";
import { env } from "../../env";
import { accruedBalance, advancedAnchor, project } from "./accrual";
import { ALL_COSTS, costOf, CREDIT_PACK_CATALOGUE } from "./costs";
import { CREDIT_CAP, CREDIT_REGEN_SECONDS, CreditFeature, CreditLedgerReason } from "./types";

type Db = FastifyInstance["db"];

/**
 * The pool handle or a transaction on it. Only for the few helpers that are called from
 * both — a read that has to see uncommitted work inside a debit, and the same read from
 * a plain request.
 */
type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Every timestamp this module writes, truncated to milliseconds.
 *
 * The same reason `modules/chat/service.ts` gives: `now()` carries microseconds and a
 * JS `Date` does not, so any value that leaves the database and comes back has already
 * lost precision.
 */
const nowToMillisecond = sql`date_trunc('milliseconds', now())`;

/** The statuses that still entitle a reader, given `expires_at` has not passed. */
const ENTITLING_STATUSES = ["active", "canceled", "billing_issue"] as const;

export type SpendOutcome =
    /** Credits are switched off entirely. Nothing was read and nothing was written. */
    | { ok: true; reason: "disabled"; cost: 0; balance: null }
    /** An active subscription. Nothing is counted. */
    | { ok: true; reason: "subscription"; cost: 0; balance: null }
    /** Already paid for. This is what makes re-reading, and a retried POST, free. */
    | { ok: true; reason: "already_unlocked"; cost: 0; balance: number | null }
    | { ok: true; reason: "charged"; cost: number; balance: number }
    | { ok: false; reason: "insufficient"; cost: number; balance: number; nextCreditAt: Date | null };

export interface CreditState {
    unlimited: boolean;
    balance: number;
    cap: number;
    nextCreditAt: Date | null;
    fullAt: Date | null;
    costs: Record<CreditFeature, number>;
    /** Which store products are credit packs, and what each is worth. */
    packs: { productId: string; credits: number }[];
    subscription: {
        status: string;
        productId: string;
        expiresAt: Date | null;
        willRenew: boolean;
    } | null;
}

export interface AccessState {
    unlocked: boolean;
    unlimited: boolean;
    cost: number;
    balance: number | null;
    affordable: boolean;
}

/**
 * Rolls the debit back and carries the reason out with it.
 *
 * Thrown rather than returned because a rollback is the only way to take the unlock row
 * with it, and thrown from here rather than via `tx.rollback()` so the value that
 * describes the failure travels with the thing that caused it.
 */
class InsufficientCreditsError extends Error {
    constructor(readonly outcome: Extract<SpendOutcome, { ok: false }>) {
        super("insufficient_credits");
        this.name = "InsufficientCreditsError";
    }
}

/** True while the reader is entitled. One indexed primary-key lookup. */
export async function hasActiveSubscription(db: Db, userId: string): Promise<boolean> {
    const [row] = await db
        .select({ userId: subscriptions.userId })
        .from(subscriptions)
        .where(
            and(
                eq(subscriptions.userId, userId),
                inArray(subscriptions.status, [...ENTITLING_STATUSES]),
                // Null would mean "never ends", which no store product here does — but a
                // row without an expiry is still better read as live than as lapsed.
                or(isNull(subscriptions.expiresAt), sql`${subscriptions.expiresAt} > now()`)
            )
        )
        .limit(1);

    return row !== undefined;
}

/**
 * The account row, created full on first sight.
 *
 * Lazy rather than at sign-up: it is one statement on a path that is writing anyway, it
 * needs no hook in the auth flow, and it self-heals for anyone a backfill missed.
 */
async function ensureAccount(db: Db, userId: string): Promise<void> {
    await db
        .insert(creditAccounts)
        .values({ userId, balance: CREDIT_CAP, balanceUpdatedAt: nowToMillisecond })
        .onConflictDoNothing();
}

/** The balance as of now, without writing anything. */
async function readProjection(db: DbOrTx, userId: string) {
    const [row] = await db
        .select({ balance: creditAccounts.balance, anchor: creditAccounts.balanceUpdatedAt })
        .from(creditAccounts)
        .where(eq(creditAccounts.userId, userId))
        .limit(1);

    if (!row) {
        // Nothing written yet, so the reader is worth exactly what they would be given.
        const now = new Date();

        return project({ balance: CREDIT_CAP, anchor: now, now });
    }

    return project({ balance: row.balance, anchor: row.anchor });
}

/**
 * Everything the credits screen shows. Read-only beyond creating the account row.
 */
export async function getCreditState(db: Db, userId: string): Promise<CreditState> {
    await ensureAccount(db, userId);

    const [subscription] = await db
        .select({
            status: subscriptions.status,
            productId: subscriptions.productId,
            expiresAt: subscriptions.expiresAt,
            willRenew: subscriptions.willRenew,
        })
        .from(subscriptions)
        .where(eq(subscriptions.userId, userId))
        .limit(1);

    /**
     * While the system is switched off every reader is reported as unlimited, so the
     * whole app — pill, paywall, locked states — behaves exactly as it did before
     * credits existed. Reporting a real balance here while nothing is charged would put
     * a paywall in front of content the server would hand over anyway.
     */
    const unlimited =
        !env.CREDITS_ENFORCED ||
        (subscription !== undefined &&
            (ENTITLING_STATUSES as readonly string[]).includes(subscription.status) &&
            (subscription.expiresAt === null || subscription.expiresAt.getTime() > Date.now()));

    const projected = await readProjection(db, userId);

    return {
        unlimited,
        balance: projected.balance,
        cap: CREDIT_CAP,
        // A subscriber is not waiting for anything, so there is nothing to count down to.
        nextCreditAt: unlimited ? null : projected.nextCreditAt,
        fullAt: unlimited ? null : projected.fullAt,
        costs: ALL_COSTS,
        packs: CREDIT_PACK_CATALOGUE,
        subscription: subscription ?? null,
    };
}

/**
 * Whether this particular thing is open, and what it would take to open it.
 *
 * The read-path counterpart to `spendCredits`, and deliberately the same order of
 * checks, so a GET and the POST behind it can never disagree about who owes what.
 */
export async function checkAccess(
    db: Db,
    input: { userId: string; feature: CreditFeature; resourceKey: string }
): Promise<AccessState> {
    const cost = costOf(input.feature);

    if (!env.CREDITS_ENFORCED) {
        return { unlocked: true, unlimited: true, cost, balance: null, affordable: true };
    }

    if (await hasActiveSubscription(db, input.userId)) {
        return { unlocked: true, unlimited: true, cost, balance: null, affordable: true };
    }

    const [unlock] = await db
        .select({ id: creditUnlocks.id })
        .from(creditUnlocks)
        .where(
            and(
                eq(creditUnlocks.userId, input.userId),
                eq(creditUnlocks.feature, input.feature),
                eq(creditUnlocks.resourceKey, input.resourceKey)
            )
        )
        .limit(1);

    const projected = await readProjection(db, input.userId);

    return {
        unlocked: unlock !== undefined,
        unlimited: false,
        cost,
        balance: projected.balance,
        affordable: projected.balance >= cost,
    };
}

/**
 * Charge for something, once.
 *
 * The one function every paid endpoint goes through. Short on purpose — the pool is
 * capped at five connections and a chat turn spends twenty seconds inside the model, so
 * nothing that talks to Gemini may be inside this transaction.
 */
export async function spendCredits(
    db: Db,
    input: { userId: string; feature: CreditFeature; resourceKey: string }
): Promise<SpendOutcome> {
    const cost = costOf(input.feature);

    if (!env.CREDITS_ENFORCED) {
        return { ok: true, reason: "disabled", cost: 0, balance: null };
    }

    if (await hasActiveSubscription(db, input.userId)) {
        return { ok: true, reason: "subscription", cost: 0, balance: null };
    }

    await ensureAccount(db, input.userId);

    try {
        return await db.transaction(async (tx) => {
            /**
             * The claim, and the mutual exclusion, in one statement — written before the
             * money moves on purpose.
             *
             * Two taps on the same horoscope: the second insert blocks on the first's
             * uncommitted row, and when the first commits it comes back empty, so the
             * second charges nothing. If the first rolls back for want of credits, the
             * second's insert succeeds and it gets its own fair try. A SELECT followed by
             * an INSERT would let both through.
             */
            const [claimed] = await tx
                .insert(creditUnlocks)
                .values({
                    userId: input.userId,
                    feature: input.feature,
                    resourceKey: input.resourceKey,
                    creditsSpent: cost,
                })
                .onConflictDoNothing()
                .returning({ id: creditUnlocks.id });

            if (!claimed) {
                const projected = await readProjection(tx, input.userId);

                return {
                    ok: true as const,
                    reason: "already_unlocked" as const,
                    cost: 0 as const,
                    balance: projected.balance,
                };
            }

            /**
             * Accrue and debit in one UPDATE whose WHERE reads the very column the SET
             * writes. That shape is the whole concurrency guarantee: under READ COMMITTED
             * a second transaction blocks on the row lock, and when the first commits
             * Postgres re-evaluates this qualification against the new tuple before
             * writing — so two sends against a balance of one cannot both pass.
             *
             * The accrual expression is interpolated twice rather than computed once in a
             * CTE. A CTE that works out the new balance and joins it back looks tidier and
             * is a lost update: the re-check passes on the join key while the SET still
             * carries the stale figure.
             */
            const [debited] = await tx
                .update(creditAccounts)
                .set({
                    balance: sql`${accruedBalance} - ${cost}`,
                    balanceUpdatedAt: advancedAnchor,
                })
                .where(and(eq(creditAccounts.userId, input.userId), gte(accruedBalance, sql`${cost}`)))
                .returning({ balance: creditAccounts.balance });

            if (!debited) {
                // Read before the rollback, because after it there is no transaction left
                // to read from.
                const projected = await readProjection(tx, input.userId);

                throw new InsufficientCreditsError({
                    ok: false,
                    reason: "insufficient",
                    cost,
                    balance: projected.balance,
                    nextCreditAt: projected.nextCreditAt,
                });
            }

            await tx.insert(creditLedger).values({
                userId: input.userId,
                delta: -cost,
                balanceAfter: debited.balance,
                reason: "spend",
                feature: input.feature,
                resourceKey: input.resourceKey,
            });

            return { ok: true as const, reason: "charged" as const, cost, balance: debited.balance };
        });
    } catch (error: unknown) {
        // Rolling the transaction back took the unlock with it, which is the point:
        // nothing was bought, so nothing may look bought.
        if (error instanceof InsufficientCreditsError) {
            return error.outcome;
        }

        throw error;
    }
}

/**
 * Gives back what a generation that never arrived cost.
 *
 * The DELETE is the mutual exclusion: it returns a row exactly once, so a dying run and
 * the stuck-generation sweeper racing to refund the same thing refund it once.
 *
 * Nothing here is conditional on the generation's state — the caller has already
 * established that by owning the transition it just made. That is sound because every
 * failure path moves `updated_at`, and a late run's write is guarded on the timestamp it
 * claimed, so a refunded reader can never also receive the content.
 */
export async function refundUnlock(
    db: Db,
    input: { userId: string; feature: CreditFeature; resourceKey: string }
): Promise<number> {
    if (!env.CREDITS_ENFORCED) {
        return 0;
    }

    return db.transaction(async (tx) => {
        const [revoked] = await tx
            .delete(creditUnlocks)
            .where(
                and(
                    eq(creditUnlocks.userId, input.userId),
                    eq(creditUnlocks.feature, input.feature),
                    eq(creditUnlocks.resourceKey, input.resourceKey)
                )
            )
            .returning({ creditsSpent: creditUnlocks.creditsSpent });

        // Nothing to give back, or a grandfathered unlock that cost nothing.
        if (!revoked || revoked.creditsSpent === 0) {
            return 0;
        }

        /**
         * Uncapped. The credits were taken from a balance that may have been above the
         * ceiling, and clamping the way back would turn a refund into a partial
         * confiscation.
         */
        const [account] = await tx
            .update(creditAccounts)
            .set({
                balance: sql`${accruedBalance} + ${revoked.creditsSpent}`,
                balanceUpdatedAt: advancedAnchor,
            })
            .where(eq(creditAccounts.userId, input.userId))
            .returning({ balance: creditAccounts.balance });

        if (!account) {
            return 0;
        }

        await tx.insert(creditLedger).values({
            userId: input.userId,
            delta: revoked.creditsSpent,
            balanceAfter: account.balance,
            reason: "refund",
            feature: input.feature,
            resourceKey: input.resourceKey,
        });

        return revoked.creditsSpent;
    });
}

/**
 * Adds credits from something that is not regeneration — a bought pack, or a clawback
 * when Apple takes one back.
 *
 * `amount` may be negative. A clawback clamps at zero rather than putting a reader in
 * debt; the ledger records the delta that was asked for, and `balance_after` what
 * actually happened.
 */
export async function grantCredits(
    db: Db,
    input: {
        userId: string;
        amount: number;
        reason: CreditLedgerReason;
        idempotencyKey: string;
        metadata?: unknown;
    }
): Promise<{ granted: boolean; balance: number | null }> {
    await ensureAccount(db, input.userId);

    return db.transaction(async (tx) => {
        /**
         * The idempotency row first, before the balance moves. A webhook and a `/sync`
         * racing the same purchase both try to write it; one wins and the loser's whole
         * transaction rolls back to nothing.
         */
        const [row] = await tx
            .insert(creditLedger)
            .values({
                userId: input.userId,
                delta: input.amount,
                // Corrected below, once the update says what it actually became.
                balanceAfter: 0,
                reason: input.reason,
                idempotencyKey: input.idempotencyKey,
                metadata: input.metadata ?? null,
            })
            /**
             * The predicate is repeated because the index is partial. Postgres cannot
             * infer a partial unique index from a bare column list — without the matching
             * WHERE this raises 42P10 rather than deduplicating, which is a grant paid
             * twice the first time a webhook is redelivered.
             */
            .onConflictDoNothing({
                target: creditLedger.idempotencyKey,
                where: sql`idempotency_key is not null`,
            })
            .returning({ id: creditLedger.id });

        if (!row) {
            return { granted: false, balance: null };
        }

        /**
         * Uncapped upwards, floored at zero. A bought pack is not regeneration, so the
         * cap does not apply to it; `accruedBalance` comes first so the hours owed before
         * the purchase are not swallowed by it.
         */
        const [account] = await tx
            .update(creditAccounts)
            .set({
                balance: sql`greatest(0, ${accruedBalance} + ${input.amount})`,
                balanceUpdatedAt: advancedAnchor,
            })
            .where(eq(creditAccounts.userId, input.userId))
            .returning({ balance: creditAccounts.balance });

        if (!account) {
            return { granted: false, balance: null };
        }

        /**
         * The one place this ledger is not strictly append-only. The alternative is
         * computing the new balance in a CTE, which costs the conditional-insert
         * idempotency above — a worse trade.
         */
        await tx.update(creditLedger).set({ balanceAfter: account.balance }).where(eq(creditLedger.id, row.id));

        return { granted: true, balance: account.balance };
    });
}

/** Seconds between credits, for the client's own countdown. */
export const ACCRUAL_INTERVAL_SECONDS = CREDIT_REGEN_SECONDS;
