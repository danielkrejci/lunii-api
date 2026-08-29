import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { FastifyInstance } from "fastify";
import { AsyncTask, CronJob } from "toad-scheduler";

import { calculateDailyScore } from ".";
import {
    compatibilityPeopleScores,
    dailyInsights,
    moonInsights,
    profile as profileTable,
    transit,
} from "../../db/schema";
import { TransitAspects } from "../../utils/natalUtils";
import { NatalChart, TransitChart } from "../astro";
import { computeTransits, utcOffsetForDate } from "../transits";
import { DailyScoreResult } from "./types";

dayjs.extend(utc);

type Db = FastifyInstance["db"];

/** Only the profile fields the engine needs — routes can pass the whole session profile. */
export interface ScoringProfile {
    birthChart: NatalChart;
    birthTime: string | null;
    /** Where the user is now, which decides what span of time their date covers. */
    timezone: string | null;
}

/** A stored score row, with numerics already turned back into numbers. */
export interface StoredScore {
    date: string;
    loveScore: number;
    careerScore: number;
    healthScore: number;
    moodScore: number;
    overallScore: number;
}

/* ============================================================
   TRANSITS
============================================================ */

/**
 * Transits for a date, from the shared table. Falls back to computing them so a
 * missing row can never turn into a missing score — the cron only keeps a window,
 * and backfill reaches outside it.
 */
export async function getOrCreateTransits(
    db: Db,
    date: string,
    timezone: string | null
): Promise<{ planets: TransitChart; aspects: TransitAspects }> {
    // A date is a different span of time in every zone, so the positions are sampled at
    // local noon and stored per offset.
    const utcOffset = utcOffsetForDate(date, timezone);

    const rows = await db
        .select()
        .from(transit)
        .where(and(eq(transit.date, date), eq(transit.utcOffset, utcOffset)));

    if (rows.length > 0) {
        return { planets: rows[0].planets as TransitChart, aspects: rows[0].aspects };
    }

    const computed = computeTransits(date, utcOffset);

    await db.insert(transit).values(computed).onConflictDoNothing();

    return { planets: computed.planets as TransitChart, aspects: computed.aspects };
}

/* ============================================================
   SCORING
============================================================ */

export function scoreProfileForDate(profile: ScoringProfile, transits: TransitChart): DailyScoreResult {
    return calculateDailyScore({
        natal: profile.birthChart,
        transits,
        hasBirthTime: profile.birthTime !== null,
    });
}

/** Row values for one computed score. Shared by the route, the backfill and the cron. */
function toRow(userId: string, date: string, result: DailyScoreResult) {
    return {
        userId,
        date,
        loveScore: result.scores.loveScore,
        careerScore: result.scores.careerScore,
        healthScore: result.scores.healthScore,
        moodScore: result.scores.moodScore,
        overallScore: result.scores.overallScore,
    };
}

/**
 * The stored score for one user and date, computing and persisting it if absent.
 *
 * Never overwrites: a row may already carry AI-generated insight text, and the
 * scores it was written from must stay the ones the user was shown.
 */
export async function getDailyScore(
    db: Db,
    input: { userId: string; profile: ScoringProfile; date: string }
): Promise<StoredScore> {
    const existing = await db
        .select()
        .from(dailyInsights)
        .where(and(eq(dailyInsights.userId, input.userId), eq(dailyInsights.date, input.date)));

    if (existing.length > 0) {
        const row = existing[0];

        return {
            date: row.date,
            loveScore: row.loveScore,
            careerScore: row.careerScore,
            healthScore: row.healthScore,
            moodScore: row.moodScore,
            overallScore: row.overallScore,
        };
    }

    const { planets } = await getOrCreateTransits(db, input.date, input.profile.timezone);
    const result = scoreProfileForDate(input.profile, planets);

    await db
        .insert(dailyInsights)
        .values(toRow(input.userId, input.date, result))
        .onConflictDoNothing();

    return {
        date: input.date,
        loveScore: result.scores.loveScore,
        careerScore: result.scores.careerScore,
        healthScore: result.scores.healthScore,
        moodScore: result.scores.moodScore,
        overallScore: result.scores.overallScore,
    };
}

/* ============================================================
   BACKFILL
============================================================ */

export function datesAround(daysBack: number, daysForward: number, anchor?: string): string[] {
    const dates: string[] = [];
    const start = anchor ? dayjs.utc(anchor) : dayjs.utc();

    for (let offset = -daysBack; offset <= daysForward; offset++) {
        dates.push(start.startOf("day").add(offset, "day").format("YYYY-MM-DD"));
    }

    return dates;
}

/**
 * Scores only — no AI. Called from the read path, which is what keeps the timeline
 * window whole; the insight text is generated lazily when a day is actually opened.
 */
export async function backfillScoresForUser(
    db: Db,
    input: {
        userId: string;
        profile: ScoringProfile;
        /** Centre of the window. Defaults to today. */
        date?: string;
        daysBack?: number;
        daysForward?: number;
    }
): Promise<number> {
    const dates = datesAround(input.daysBack ?? 7, input.daysForward ?? 7, input.date);

    const existing = await db
        .select({ date: dailyInsights.date })
        .from(dailyInsights)
        .where(and(eq(dailyInsights.userId, input.userId), inArray(dailyInsights.date, dates)));

    const have = new Set(existing.map((row) => row.date));
    const missing = dates.filter((date) => !have.has(date));

    if (missing.length === 0) {
        return 0;
    }

    const values = [];

    for (const date of missing) {
        const { planets } = await getOrCreateTransits(db, date, input.profile.timezone);

        values.push(toRow(input.userId, date, scoreProfileForDate(input.profile, planets)));
    }

    await db.insert(dailyInsights).values(values).onConflictDoNothing();

    return values.length;
}

/* ============================================================
   CRON
============================================================ */

const CRON_BATCH_SIZE = 500;

/**
 * One day, every onboarded user. Scores are per-user now, so this is a batched loop
 * rather than a single INSERT ... SELECT — still cheap, since scoring one user is
 * ~110 aspect checks.
 */
export async function generateScoresForAllUsers(db: Db, date: string): Promise<number> {
    /**
     * Transits differ by zone, so they are fetched per offset rather than once. The map
     * keeps each one for the whole run — there are a few dozen zones in the world and
     * far more users than that.
     */
    const transitsByOffset = new Map<number, TransitChart>();

    const transitsFor = async (timezone: string | null): Promise<TransitChart> => {
        const utcOffset = utcOffsetForDate(date, timezone);
        const cached = transitsByOffset.get(utcOffset);

        if (cached) {
            return cached;
        }

        const { planets } = await getOrCreateTransits(db, date, timezone);

        transitsByOffset.set(utcOffset, planets);

        return planets;
    };

    let offset = 0;
    let written = 0;

    for (;;) {
        const batch = await db
            .select({
                userId: profileTable.userId,
                birthChart: profileTable.birthChart,
                birthTime: profileTable.birthTime,
                timezone: profileTable.timezone,
            })
            .from(profileTable)
            .orderBy(profileTable.userId)
            .limit(CRON_BATCH_SIZE)
            .offset(offset);

        if (batch.length === 0) {
            break;
        }

        const values = [];

        for (const row of batch) {
            const profile = { birthChart: row.birthChart, birthTime: row.birthTime, timezone: row.timezone };

            values.push(toRow(row.userId, date, scoreProfileForDate(profile, await transitsFor(row.timezone))));
        }

        await db.insert(dailyInsights).values(values).onConflictDoNothing();

        written += values.length;
        offset += batch.length;
    }

    return written;
}

export async function executeDailyScoresGeneration(db: Db): Promise<void> {
    const date = dayjs.utc().startOf("day").add(1, "day").format("YYYY-MM-DD");

    console.log("[CRON] Generating daily scores for", date);

    const count = await generateScoresForAllUsers(db, date);

    console.log("[CRON] Done, wrote", count);
}

/**
 * A run that claimed a day and then died — a deploy mid-generation, a crashed process —
 * leaves the row in `pending` with nothing working on it.
 *
 * The claim in the insight route takes such a row back on its own after the same
 * timeout, so correctness does not depend on this job. It exists so the client stops
 * polling a day nobody is generating and gets an error it can retry instead.
 */
export function createStuckGenerationsJob(db: Db) {
    const task = new AsyncTask(
        "fail-stuck-generations",
        async () => {
            const insights = await db
                .update(dailyInsights)
                .set({ status: "failed", updatedAt: sql`date_trunc('milliseconds', now())` })
                .where(
                    and(
                        eq(dailyInsights.status, "pending"),
                        lt(dailyInsights.updatedAt, sql`now() - interval '5 minutes'`)
                    )
                )
                .returning({ date: dailyInsights.date });

            const compatibility = await db
                .update(compatibilityPeopleScores)
                .set({ status: "failed", updatedAt: sql`date_trunc('milliseconds', now())` })
                .where(
                    and(
                        eq(compatibilityPeopleScores.status, "pending"),
                        lt(compatibilityPeopleScores.updatedAt, sql`now() - interval '5 minutes'`)
                    )
                )
                .returning({ date: compatibilityPeopleScores.date });

            const moon = await db
                .update(moonInsights)
                .set({ status: "failed", updatedAt: sql`date_trunc('milliseconds', now())` })
                .where(
                    and(
                        eq(moonInsights.status, "pending"),
                        lt(moonInsights.updatedAt, sql`now() - interval '5 minutes'`)
                    )
                )
                .returning({ date: moonInsights.date });

            const stuck = insights.length + compatibility.length + moon.length;

            if (stuck > 0) {
                console.log("[CRON] Timed out", stuck, "stuck generation(s)");
            }
        },
        (err) => {
            console.error("[CRON ERROR]", err);
        }
    );

    return new CronJob({ cronExpression: "* * * * *" }, task);
}

export function createDailyScoresJob(db: Db) {
    const task = new AsyncTask(
        "generate-daily-scores",
        async () => {
            await executeDailyScoresGeneration(db);
        },
        (err) => {
            console.error("[CRON ERROR]", err);
        }
    );

    // Offset from the transit job so the logs read in order. Correctness does not
    // depend on it: getOrCreateTransits computes what is missing.
    return new CronJob({ cronExpression: "15 0 * * *" }, task);
}
