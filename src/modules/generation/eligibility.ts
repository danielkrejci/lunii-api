import dayjs from "dayjs";
import { and, asc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { FastifyInstance } from "fastify";

import { dailyInsights, profile as profileTable, subscriptions } from "../../db/schema";
import { ENTITLING_STATUSES } from "../credits/service";

type Profile = typeof profileTable.$inferSelect;

/**
 * How recently someone must have opened the app to be written for in advance.
 *
 * Pre-generation is speculative: the text is paid for before anyone asks, so a reader
 * who never returns is money spent on nothing. Two days is wide enough to cover a normal
 * gap and narrow enough that a lapsed account stops costing anything.
 */
const ACTIVE_WITHIN_DAYS = 2;

/** The subscription half of the same question `hasActiveSubscription` asks one user at a time. */
const entitled = and(
    inArray(subscriptions.status, [...ENTITLING_STATUSES]),
    or(isNull(subscriptions.expiresAt), sql`${subscriptions.expiresAt} > now()`)
);

/**
 * The next batch's worth of readers who still have no horoscope for the day.
 *
 * Three things are deliberately done in SQL rather than after the fact, and each was a
 * ceiling before:
 *
 * The **time zone** is a `WHERE`, not a filter over everyone. Cohorts are submitted an
 * hour apart, so filtering in memory meant reading the whole profile table once per zone
 * — roughly forty times a night to find forty slices of it.
 *
 * The **limit** is what makes this safe at any size. Only one chunk is ever held, so
 * memory no longer tracks how many readers there are.
 *
 * And **"still unwritten"** is a join rather than a second pass. Because claiming marks
 * a row `queued`, asking again returns the *next* unwritten chunk — which is what lets
 * a cohort be walked a batch at a time without an offset that could drift.
 */
export async function selectOutstandingForCohort(
    fastify: FastifyInstance,
    input: { targetDate: string; timezones: (string | null)[]; limit: number }
): Promise<Profile[]> {
    const activeSince = dayjs.utc().subtract(ACTIVE_WITHIN_DAYS, "day").toDate();

    const named = input.timezones.filter((zone): zone is string => zone !== null);

    const zoneMatches = input.timezones.includes(null)
        ? or(isNull(profileTable.timezone), inArray(profileTable.timezone, named))
        : inArray(profileTable.timezone, named);

    const rows = await fastify.db
        .select({ profile: profileTable })
        .from(profileTable)
        .leftJoin(subscriptions, and(eq(subscriptions.userId, profileTable.userId), entitled))
        .leftJoin(
            dailyInsights,
            and(eq(dailyInsights.userId, profileTable.userId), eq(dailyInsights.date, input.targetDate))
        )
        .where(
            and(
                // A subscriber is always worth writing for; everyone else has to have been here.
                or(sql`${subscriptions.userId} is not null`, gte(profileTable.lastActiveAt, activeSince)),
                zoneMatches,
                isNull(dailyInsights.content),
                // `queued` is excluded by this: a day already in a batch is not outstanding.
                or(isNull(dailyInsights.status), eq(dailyInsights.status, "absent"))
            )
        )
        .orderBy(asc(profileTable.userId))
        .limit(input.limit);

    return rows.map((row) => row.profile);
}
