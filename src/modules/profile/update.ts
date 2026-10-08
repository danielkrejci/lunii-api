import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { FastifyInstance } from "fastify";

import {
    compatibilityPeople,
    compatibilityPeopleScores,
    dailyInsights,
    moonInsights,
    planetInsights,
    profile as profileTable,
} from "../../db/schema";
import { NatalChart } from "../astro";
import { calculateCompatibility } from "../compatibilityPeople/aspects";
import { BASE_NORMALIZER } from "../compatibilityPeople/calibration";
import { scoreDay } from "../compatibilityPeople/daily";
import { startCompatibilityGeneration } from "../compatibilityPeople/generateDetail";
import { normalizeScore } from "../compatibilityPeople/normalizer";
import { getDailyScore, getOrCreateTransits } from "../dailyScore/service";
import { startDailyInsightGeneration } from "../insights/generateDaily";
import { startPlanetInsightGeneration } from "../insights/generatePlanets";
import { ensureMoonRow, startMoonInsightGeneration } from "../moon/generate";
import { ChangeScope } from "./diff";

type Db = FastifyInstance["db"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Profile = typeof profileTable.$inferSelect;

export { diffProfile } from "./diff";
export type { ChangeScope, ProfileChanges } from "./diff";

/* ============================================================
   WHAT EXISTS TODAY
============================================================ */

/**
 * Today's texts that are written or being written, and so have to be written again.
 *
 * Only these: a text nobody has opened yet — a Moon a reader without a subscription
 * never bought, say — is left to be written on demand, from the new profile, when it
 * is opened. `queued` counts for the horoscope, which is the one the nightly batch
 * writes ahead.
 */
export interface TodaysTexts {
    daily: boolean;
    moon: boolean;
    planets: boolean;
    personIds: string[];
}

const LIVE = ["ready", "pending", "queued"] as const;

export async function findTodaysTexts(db: Db, input: { userId: string; date: string }): Promise<TodaysTexts> {
    const { userId, date } = input;

    const [daily] = await db
        .select({ status: dailyInsights.status })
        .from(dailyInsights)
        .where(and(eq(dailyInsights.userId, userId), eq(dailyInsights.date, date)));

    const [moon] = await db
        .select({ status: moonInsights.status })
        .from(moonInsights)
        .where(and(eq(moonInsights.userId, userId), eq(moonInsights.date, date)));

    const [planets] = await db
        .select({ status: planetInsights.status })
        .from(planetInsights)
        .where(and(eq(planetInsights.userId, userId), eq(planetInsights.date, date)));

    const people = await db
        .select({ id: compatibilityPeopleScores.personId })
        .from(compatibilityPeopleScores)
        .innerJoin(compatibilityPeople, eq(compatibilityPeople.id, compatibilityPeopleScores.personId))
        .where(
            and(
                eq(compatibilityPeople.userId, userId),
                eq(compatibilityPeopleScores.date, date),
                inArray(compatibilityPeopleScores.status, [...LIVE])
            )
        );

    const live = (status: string | undefined) => (LIVE as readonly string[]).includes(status ?? "");

    return {
        daily: live(daily?.status),
        moon: live(moon?.status),
        planets: live(planets?.status),
        personIds: people.map((row) => row.id),
    };
}

/** Whether today's horoscope is being written right now — the one wait the app shows. */
export async function isDailyGenerating(db: Db, input: { userId: string; date: string }): Promise<boolean> {
    const [row] = await db
        .select({ status: dailyInsights.status })
        .from(dailyInsights)
        .where(and(eq(dailyInsights.userId, input.userId), eq(dailyInsights.date, input.date)));

    return row?.status === "pending";
}

/* ============================================================
   CLEAR
============================================================ */

/**
 * Takes away everything written from the old profile, from `date` on.
 *
 * Past days are left alone: the reader read them, about the person they said they were
 * then. A new chart takes the whole row, scores included — they were computed from the
 * old chart, and the reads recompute them. New wording keeps the scores and drops only
 * the text.
 *
 * Every write moves `updated_at`, so a generation still running on the old profile
 * finds its row gone or changed and discards what it wrote. The batch writes only into
 * a `queued` row, so a horoscope queued for tomorrow is dropped the same way.
 *
 * Returns the upcoming days whose horoscope row a new chart deleted: the batch claims
 * only rows that exist, so `restoreUpcomingDays` puts them back, unwritten, for it.
 */
export async function clearWrittenFrom(
    tx: Tx,
    input: { userId: string; date: string; scope: ChangeScope }
): Promise<{ upcomingDailyDates: string[] }> {
    const { userId, date, scope } = input;

    if (scope === "none") {
        return { upcomingDailyDates: [] };
    }

    const ownPeople = tx
        .select({ id: compatibilityPeople.id })
        .from(compatibilityPeople)
        .where(eq(compatibilityPeople.userId, userId));

    if (scope === "chart") {
        const deleted = await tx
            .delete(dailyInsights)
            .where(and(eq(dailyInsights.userId, userId), gte(dailyInsights.date, date)))
            .returning({ date: dailyInsights.date });

        await tx.delete(moonInsights).where(and(eq(moonInsights.userId, userId), gte(moonInsights.date, date)));
        await tx.delete(planetInsights).where(and(eq(planetInsights.userId, userId), gte(planetInsights.date, date)));
        await tx
            .delete(compatibilityPeopleScores)
            .where(
                and(inArray(compatibilityPeopleScores.personId, ownPeople), gte(compatibilityPeopleScores.date, date))
            );

        return { upcomingDailyDates: deleted.map((row) => row.date).filter((day) => day > date) };
    }

    const unwritten = {
        content: null,
        status: "absent" as const,
        updatedAt: sql`date_trunc('milliseconds', now())`,
    };

    await tx
        .update(dailyInsights)
        .set(unwritten)
        .where(and(eq(dailyInsights.userId, userId), gte(dailyInsights.date, date)));
    await tx
        .update(moonInsights)
        .set(unwritten)
        .where(and(eq(moonInsights.userId, userId), gte(moonInsights.date, date)));
    await tx
        .update(planetInsights)
        .set(unwritten)
        .where(and(eq(planetInsights.userId, userId), gte(planetInsights.date, date)));
    await tx
        .update(compatibilityPeopleScores)
        .set(unwritten)
        .where(and(inArray(compatibilityPeopleScores.personId, ownPeople), gte(compatibilityPeopleScores.date, date)));

    // Reset rather than deleted, so the rows are still there for the batch to claim.
    return { upcomingDailyDates: [] };
}

/**
 * Upcoming horoscope rows a new chart deleted, scored again and left unwritten.
 *
 * The nightly batch only claims rows that exist — the scores cron creates them once a
 * night — so without this a day already scored ahead would be written on demand instead
 * of in the next batch.
 */
export async function restoreUpcomingDays(db: Db, input: { profile: Profile; dates: string[] }) {
    for (const date of input.dates) {
        await getDailyScore(db, { userId: input.profile.userId, profile: input.profile, date });
    }
}

/**
 * Every saved person's standing compatibility, against the reader's new chart.
 *
 * Stored per person and computed against the reader's chart, so a new chart leaves all
 * of them describing a pair that no longer exists.
 */
export async function rebaseCompatibility(tx: Tx, input: { userId: string; readerChart: NatalChart }) {
    const people = await tx
        .select({ id: compatibilityPeople.id, birthChart: compatibilityPeople.birthChart })
        .from(compatibilityPeople)
        .where(eq(compatibilityPeople.userId, input.userId));

    for (const person of people) {
        const baseCompatibility = calculateCompatibility(input.readerChart, person.birthChart);

        await tx
            .update(compatibilityPeople)
            .set({ baseCompatibility, baseScore: normalizeScore(baseCompatibility.overall, BASE_NORMALIZER) })
            .where(eq(compatibilityPeople.id, person.id));
    }
}

/* ============================================================
   WRITE AGAIN
============================================================ */

/**
 * Starts today's texts again from the new profile — only the ones that existed.
 *
 * The horoscope first: the Moon and the planets quote it and wait for it. Each start
 * only claims a row and returns, so this does not wait for any model. Rows are created
 * first because a claim is an UPDATE, and a new chart deleted them.
 */
export async function rewriteToday(
    fastify: FastifyInstance,
    input: { profile: Profile; date: string; texts: TodaysTexts }
): Promise<void> {
    const { profile, date, texts } = input;
    const userId = profile.userId;

    if (texts.daily) {
        await getDailyScore(fastify.db, { userId, profile, date });
        await startDailyInsightGeneration(fastify, { userId, profile, date, allowFailed: true });
    }

    if (texts.moon) {
        await ensureMoonRow(fastify.db, { userId, profile, date });
        await startMoonInsightGeneration(fastify, { userId, profile, date, allowFailed: true });
    }

    if (texts.planets) {
        await fastify.db.insert(planetInsights).values({ userId, date }).onConflictDoNothing();
        await startPlanetInsightGeneration(fastify, { userId, profile, date, allowFailed: true });
    }

    for (const personId of texts.personIds) {
        const person = await scoredPerson(fastify.db, { personId, profile, date });

        if (person) {
            await startCompatibilityGeneration(fastify, { person, profile, date, allowFailed: true });
        }
    }
}

/** The person with today's score, scoring and storing it when a new chart dropped it. */
async function scoredPerson(db: Db, input: { personId: string; profile: Profile; date: string }) {
    const [person] = await db
        .select({
            id: compatibilityPeople.id,
            name: compatibilityPeople.name,
            gender: compatibilityPeople.gender,
            relationship: compatibilityPeople.relationship,
            sign: compatibilityPeople.sunSign,
            birthChart: compatibilityPeople.birthChart,
            baseCompatibility: compatibilityPeople.baseCompatibility,
        })
        .from(compatibilityPeople)
        .where(eq(compatibilityPeople.id, input.personId));

    if (!person) {
        return null;
    }

    const { planets } = await getOrCreateTransits(db, input.date, input.profile.timezone);

    const { score, compatibility } = scoreDay({
        readerChart: input.profile.birthChart,
        personChart: person.birthChart,
        baseOverall: person.baseCompatibility.overall,
        transits: planets,
    });

    // Deterministic, so a row another request wrote meanwhile holds the same numbers.
    await db
        .insert(compatibilityPeopleScores)
        .values({ personId: person.id, date: input.date, score, compatibility })
        .onConflictDoNothing();

    return {
        id: person.id,
        name: person.name,
        gender: person.gender,
        relationship: person.relationship,
        sign: person.sign,
        score,
        compatibility,
    };
}
