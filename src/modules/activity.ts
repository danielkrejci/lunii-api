import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { FastifyInstance } from "fastify";

import { profile } from "../db/schema";

type Db = FastifyInstance["db"];

/** Coarse on purpose: this decides a nightly cohort, not a session timeline. */
const TOUCH_INTERVAL = sql`now() - interval '1 hour'`;

/**
 * Records that the app was opened, at most once an hour.
 *
 * Pre-generation is speculative spending: the content is written and paid for before
 * anyone asks for it, and a reader who never comes back is money gone. Restricting it
 * to people who have been around recently is what keeps that in proportion, and this is
 * the only place that knows they were.
 *
 * The hour guard lives in the WHERE rather than in a read-then-write, so the common
 * case — a client polling a pending day every five seconds — matches no rows and costs
 * nothing beyond the index lookup.
 *
 * Never allowed to be the reason a request fails. Being wrong about a cohort for one
 * night is nothing; refusing to serve a horoscope over it would be absurd.
 */
export async function touchLastActive(db: Db, userId: string): Promise<void> {
    await db
        .update(profile)
        .set({ lastActiveAt: sql`now()` })
        .where(
            and(eq(profile.userId, userId), or(isNull(profile.lastActiveAt), lt(profile.lastActiveAt, TOUCH_INTERVAL)))
        )
        .catch(() => {});
}
