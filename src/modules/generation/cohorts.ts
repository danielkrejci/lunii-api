import { FastifyInstance } from "fastify";

import { profile } from "../../db/schema";
import { utcOffsetForDate } from "../transits";

/**
 * Zones grouped by the offset they have on a given date.
 *
 * Grouped rather than resolved per reader, because a UTC offset is not a column: it
 * comes out of the zone name and the date, which only JavaScript knows. Resolving it
 * here over the few dozen distinct zones turns it into something SQL can filter on —
 * `timezone IN (...)` — instead of a condition that could only be applied after loading
 * every profile.
 *
 * Daylight saving is why the date matters: the same zone is a different cohort in
 * January and in July.
 */
export async function groupZonesByOffset(
    fastify: FastifyInstance,
    date: string
): Promise<Map<number, (string | null)[]>> {
    const rows = await fastify.db.selectDistinct({ timezone: profile.timezone }).from(profile);

    const byOffset = new Map<number, (string | null)[]>();

    for (const { timezone } of rows) {
        const offsetMinutes = utcOffsetForDate(date, timezone);
        const existing = byOffset.get(offsetMinutes);

        if (existing) {
            existing.push(timezone);
        } else {
            byOffset.set(offsetMinutes, [timezone]);
        }
    }

    return byOffset;
}

/**
 * The shard key a batch is filed under: its offset and its place in the cohort.
 *
 * It has to survive a round trip through the database, because the adapter that claims
 * the rows is handed nothing but this string. `utc60-2` is the third batch of everyone
 * an hour ahead of UTC.
 */
export function shardKeyFor(offsetMinutes: number, chunk: number): string {
    return `utc${offsetMinutes}-${chunk}`;
}

/**
 * The zones a shard key stands for, recovered when the batch is claimed.
 *
 * Recomputed from the zone list rather than carried in memory between the scheduler and
 * the claim: it is a few dozen rows, and the alternative was a mutable global that the
 * two would have had to agree about.
 *
 * Returns nothing for a key it cannot read — one written by an older version, say.
 * Claiming nothing is the safe failure: the day stays unwritten and the reader's own
 * visit generates it.
 */
export async function cohortFromShardKey(
    fastify: FastifyInstance,
    date: string,
    shardKey: string
): Promise<{ offsetMinutes: number; timezones: (string | null)[] } | null> {
    const match = /^utc(-?\d+)-\d+$/.exec(shardKey);

    if (!match) {
        return null;
    }

    const offsetMinutes = Number(match[1]);
    const timezones = (await groupZonesByOffset(fastify, date)).get(offsetMinutes);

    return timezones ? { offsetMinutes, timezones } : null;
}
