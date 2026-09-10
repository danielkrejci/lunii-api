import { SQL, sql } from "drizzle-orm";

import { creditAccounts } from "../../db/schema";
import { CREDIT_CAP, CREDIT_REGEN_SECONDS } from "./types";

/**
 * Regeneration, as SQL for the write paths and as TypeScript for everything else.
 *
 * The SQL is the source of truth: it is what runs inside the debit, where two requests
 * are racing and correctness matters. `project()` mirrors it so a read can answer
 * without writing and so the rules can be tested without a database. `accrual.test.ts`
 * pins the cases the two must agree on.
 */

/**
 * Whole hours since the anchor.
 *
 * `greatest(0, ...)` because an anchor can legitimately sit in the future — a grant sets
 * it to `now()` on a machine whose clock later steps back — and a negative accrual would
 * quietly take credits away.
 */
const elapsedHours: SQL<number> = sql`greatest(
    0,
    floor(extract(epoch from (now() - ${creditAccounts.balanceUpdatedAt})) / ${CREDIT_REGEN_SECONDS})
)::int`;

/**
 * What the balance actually is right now.
 *
 * `balance + least(accrued, cap - balance)`, and deliberately NOT
 * `least(cap, balance + accrued)`. The two agree until a reader buys a pack: with a
 * balance of 60 and a cap of 24 the naive form clamps to 24 and destroys 36 paid-for
 * credits on the very next read. Regeneration tops up *to* the ceiling; it never pushes
 * anyone down to it.
 */
export const accruedBalance: SQL<number> = sql`(
    ${creditAccounts.balance}
    + least(${elapsedHours}, greatest(0, ${CREDIT_CAP} - ${creditAccounts.balance}))
)`;

/**
 * The anchor after accrual: forward by whole hours only.
 *
 * This is what makes a spend at half past the hour cost nothing but credits — the next
 * one still lands at the top of the original hour. Spending does not touch the anchor
 * at all; the only thing that moves it is the hours it has already paid out.
 *
 * It moves even when the reader was full and nothing was credited. That is deliberate:
 * someone who sat at the cap for three days and then spends one credit should wait an
 * hour like everybody else, not be handed seventy-two back.
 */
export const advancedAnchor: SQL<Date> = sql`(
    ${creditAccounts.balanceUpdatedAt} + make_interval(hours => ${elapsedHours})
)`;

export interface Projection {
    /** The spendable balance as of `now`. */
    balance: number;
    /** Where the anchor would be left if this projection were written. */
    anchor: Date;
    /** Null at or above the cap: nothing is coming. */
    nextCreditAt: Date | null;
    /** When the balance would reach the cap. Null once it already has. */
    fullAt: Date | null;
}

export function project(input: { balance: number; anchor: Date; now?: Date; cap?: number }): Projection {
    const cap = input.cap ?? CREDIT_CAP;
    const now = input.now ?? new Date();
    const intervalMs = CREDIT_REGEN_SECONDS * 1000;

    const elapsed = Math.max(0, Math.floor((now.getTime() - input.anchor.getTime()) / intervalMs));

    // The same shape as `accruedBalance` above, for the same reason.
    const balance = input.balance + Math.min(elapsed, Math.max(0, cap - input.balance));
    const anchor = new Date(input.anchor.getTime() + elapsed * intervalMs);

    return {
        balance,
        anchor,
        nextCreditAt: balance >= cap ? null : new Date(anchor.getTime() + intervalMs),
        fullAt: balance >= cap ? null : new Date(anchor.getTime() + (cap - balance) * intervalMs),
    };
}
