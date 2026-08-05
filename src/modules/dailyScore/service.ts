import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import { and, eq, inArray } from "drizzle-orm";
import { FastifyInstance } from "fastify";
import { AsyncTask, CronJob } from "toad-scheduler";

import { calculateDailyScore } from ".";
import { dailyInsights, profile as profileTable, transit } from "../../db/schema";
import { TransitAspects } from "../../utils/natalUtils";
import { NatalChart, transitInstantForDate, TransitChart } from "../astro";
import { computeTransits } from "../transits";
import { CALIBRATION_VERSION } from "./calibration";
import { DailyScoreResult } from "./types";
import { ENGINE_VERSION } from "./version";

dayjs.extend(utc);

type Db = FastifyInstance["db"];

/** Only the profile fields the engine needs — routes can pass the whole session profile. */
export interface ScoringProfile {
    birthChart: NatalChart;
    birthTime: string | null;
}

/** A stored score row, with numerics already turned back into numbers. */
export interface StoredScore {
    date: string;
    loveScore: number;
    careerScore: number;
    healthScore: number;
    moodScore: number;
    overallScore: number;
    confidence: number | null;
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
    date: string
): Promise<{ planets: TransitChart; aspects: TransitAspects }> {
    const rows = await db.select().from(transit).where(eq(transit.date, date));

    if (rows.length > 0) {
        return { planets: rows[0].planets as TransitChart, aspects: rows[0].aspects };
    }

    const computed = computeTransits(transitInstantForDate(date));

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
        rawScores: result.raw,
        confidence: result.confidence,
        scoreBreakdown: result.breakdown,
        engineVersion: ENGINE_VERSION,
        calibrationVersion: CALIBRATION_VERSION,
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
            loveScore: Number(row.loveScore),
            careerScore: Number(row.careerScore),
            healthScore: Number(row.healthScore),
            moodScore: Number(row.moodScore),
            overallScore: Number(row.overallScore),
            confidence: row.confidence === null ? null : Number(row.confidence),
        };
    }

    const { planets } = await getOrCreateTransits(db, input.date);
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
        confidence: result.confidence,
    };
}

/* ============================================================
   BACKFILL
============================================================ */

export function datesAround(daysBack: number, daysForward: number): string[] {
    const dates: string[] = [];

    for (let offset = -daysBack; offset <= daysForward; offset++) {
        dates.push(dayjs.utc().startOf("day").add(offset, "day").format("YYYY-MM-DD"));
    }

    return dates;
}

/**
 * Scores only — no AI. Runs on sign-in so the app has a filled window immediately;
 * the insight text is generated lazily when a day is actually opened.
 */
export async function backfillScoresForUser(
    db: Db,
    input: { userId: string; profile: ScoringProfile; daysBack?: number; daysForward?: number }
): Promise<number> {
    const dates = datesAround(input.daysBack ?? 7, input.daysForward ?? 7);

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
        const { planets } = await getOrCreateTransits(db, date);

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
    const { planets } = await getOrCreateTransits(db, date);

    let offset = 0;
    let written = 0;

    for (;;) {
        const batch = await db
            .select({
                userId: profileTable.userId,
                birthChart: profileTable.birthChart,
                birthTime: profileTable.birthTime,
            })
            .from(profileTable)
            .orderBy(profileTable.userId)
            .limit(CRON_BATCH_SIZE)
            .offset(offset);

        if (batch.length === 0) {
            break;
        }

        const values = batch.map((row) =>
            toRow(
                row.userId,
                date,
                scoreProfileForDate({ birthChart: row.birthChart, birthTime: row.birthTime }, planets)
            )
        );

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
