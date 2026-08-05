import { fromNodeHeaders } from "better-auth/node";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import { and, asc, between, eq, isNull } from "drizzle-orm";
import { FastifyInstance, FastifyPluginAsync } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { dailyInsights } from "../../db/schema";
import { auth } from "../../lib/auth";
import { summarizePlanetInfluence } from "../../modules/dailyScore";
import { CALIBRATION_VERSION } from "../../modules/dailyScore/calibration";
import {
    getDailyScore,
    getOrCreateTransits,
    ScoringProfile,
    scoreProfileForDate,
} from "../../modules/dailyScore/service";
import { ENGINE_VERSION } from "../../modules/dailyScore/version";
import { DailyTransits, generateDailyInsight } from "../../modules/insights";
import { serializeDrizzleData } from "../../utils/drizzleUtils";

dayjs.extend(utc);

const errorSchema = z.object({
    error: z.object({
        code: z.string(),
        message: z.string(),
    }),
});

const textInsight = z.object({
    score: z.number(),
    /** Null until the horoscope has been generated. The score never is. */
    insight: z.string().nullable(),
    reason: z.string().nullable(),
});

/**
 * Shared by the read and the generate route so a generate response can go straight
 * into the client's query cache without a refetch.
 *
 * Everything the engine produces — scores, timeline, planetary weights — is always
 * present. Only the written parts are nullable, because they cost an AI request.
 */
const responseSchema = z.object({
    data: z.object({
        date: z.string(),
        /** False while the written fields are still null. */
        generated: z.boolean(),
        overview: z.object({ title: z.string(), description: z.string() }).nullable(),
        moon: z.object({ phase: z.string(), insight: z.string(), reason: z.string() }).nullable(),
        insights: z.object({
            love: textInsight,
            career: textInsight,
            health: textInsight,
            mood: textInsight,
            overall: textInsight,
        }),
        opportunity: z.object({ description: z.string(), examples: z.array(z.string()) }).nullable(),
        watchOut: z.object({ description: z.string(), examples: z.array(z.string()) }).nullable(),
        deepInsight: z.string().nullable(),
        timeline: z.array(
            z.object({
                date: z.string(),
                isToday: z.boolean(),
                isTomorrow: z.boolean(),
                isYesterday: z.boolean(),
                love: z.number(),
                career: z.number(),
                health: z.number(),
                mood: z.number(),
                overall: z.number(),
            })
        ),
        planets: z.array(z.object({ name: z.string(), score: z.number() })),
    }),
});

async function buildResponse(
    db: FastifyInstance["db"],
    input: { userId: string; profile: ScoringProfile; date: string }
) {
    const { date, userId } = input;

    const tomorrow = dayjs.utc(date).add(1, "day").format("YYYY-MM-DD");
    const yesterday = dayjs.utc(date).add(-1, "day").format("YYYY-MM-DD");

    const timelineStartDate = dayjs.utc(date).subtract(4, "days").format("YYYY-MM-DD");
    const timelineEndDate = dayjs.utc(date).add(2, "days").format("YYYY-MM-DD");

    // Deterministic and idempotent, so it is safe on the read path: guarantees the row
    // exists and that the timeline has a value for this date.
    const scores = await getDailyScore(db, { userId, profile: input.profile, date });

    const stored = await db.query.dailyInsights.findFirst({
        where: and(eq(dailyInsights.userId, userId), eq(dailyInsights.date, date)),
    });

    const transitData = await getOrCreateTransits(db, date);
    const score = scoreProfileForDate(input.profile, transitData.planets);

    const timeline = await db
        .select({
            date: dailyInsights.date,
            love: dailyInsights.loveScore,
            career: dailyInsights.careerScore,
            health: dailyInsights.healthScore,
            mood: dailyInsights.moodScore,
            overall: dailyInsights.overallScore,
        })
        .from(dailyInsights)
        .where(and(eq(dailyInsights.userId, userId), between(dailyInsights.date, timelineStartDate, timelineEndDate)))
        .orderBy(asc(dailyInsights.date));

    return serializeDrizzleData({
        date,
        generated: Boolean(stored?.deepInsight),
        overview: stored?.overview ?? null,
        moon: stored?.moon ?? null,
        insights: {
            love: {
                score: scores.loveScore,
                insight: stored?.loveInsight?.insight ?? null,
                reason: stored?.loveInsight?.reason ?? null,
            },
            career: {
                score: scores.careerScore,
                insight: stored?.careerInsight?.insight ?? null,
                reason: stored?.careerInsight?.reason ?? null,
            },
            health: {
                score: scores.healthScore,
                insight: stored?.healthInsight?.insight ?? null,
                reason: stored?.healthInsight?.reason ?? null,
            },
            mood: {
                score: scores.moodScore,
                insight: stored?.moodInsight?.insight ?? null,
                reason: stored?.moodInsight?.reason ?? null,
            },
            overall: {
                score: scores.overallScore,
                insight: stored?.overallInsight?.insight ?? null,
                reason: stored?.overallInsight?.reason ?? null,
            },
        },
        opportunity: stored?.opportunity ?? null,
        watchOut: stored?.watchOut ?? null,
        deepInsight: stored?.deepInsight ?? null,
        timeline: timeline.map((item) => ({
            ...item,
            isToday: item.date === date,
            isTomorrow: item.date === tomorrow,
            isYesterday: item.date === yesterday,
        })),
        planets: summarizePlanetInfluence(score.impacts).map((weight) => ({
            name: weight.name,
            score: weight.score,
        })),
    });
}

export default (async (fastify) => {
    /* ============================================================
       READ — safe to prefetch, retry and refetch
    ============================================================ */

    fastify.withTypeProvider<ZodTypeProvider>().get(
        "/insight",
        {
            schema: {
                querystring: z.object({
                    date: z.string().refine((val) => dayjs.utc(val).isValid(), {
                        message: "Invalid date format",
                    }),
                }),
                response: { 200: responseSchema, 401: errorSchema, 409: errorSchema, 500: errorSchema },
            },
        },
        async (request, reply) => {
            const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });

            if (!session) {
                return reply.status(401).send({
                    error: { code: "unauthorized", message: "User must be logged in to access this resource." },
                });
            }

            if (!session.profile) {
                return reply.status(409).send({
                    error: { code: "profile_required", message: "User must complete onboarding first." },
                });
            }

            try {
                const data = await buildResponse(fastify.db, {
                    userId: session.user.id,
                    profile: session.profile,
                    date: dayjs.utc(request.query.date).format("YYYY-MM-DD"),
                });

                return reply.status(200).send({ data });
            } catch (error: unknown) {
                const isDev = process.env.NODE_ENV !== "production";

                request.log.error({ err: error }, "Failed to read daily insight");

                return reply.status(500).send({
                    error: {
                        code: "error",
                        message:
                            isDev && error instanceof Error ? (error.stack ?? error.message) : "Internal Server Error",
                    },
                });
            }
        }
    );

    /* ============================================================
       GENERATE — costs an AI request, so it is explicit
    ============================================================ */

    fastify.withTypeProvider<ZodTypeProvider>().post(
        "/insight/generate",
        {
            schema: {
                body: z.object({
                    date: z.string().refine((val) => dayjs.utc(val).isValid(), {
                        message: "Invalid date format",
                    }),
                }),
                response: { 200: responseSchema, 401: errorSchema, 409: errorSchema, 500: errorSchema },
            },
        },
        async (request, reply) => {
            const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });

            if (!session) {
                return reply.status(401).send({
                    error: { code: "unauthorized", message: "User must be logged in to access this resource." },
                });
            }

            if (!session.profile) {
                return reply.status(409).send({
                    error: { code: "profile_required", message: "User must complete onboarding first." },
                });
            }

            try {
                const date = dayjs.utc(request.body.date).format("YYYY-MM-DD");

                const existing = await fastify.db.query.dailyInsights.findFirst({
                    columns: { deepInsight: true },
                    where: and(eq(dailyInsights.userId, session.user.id), eq(dailyInsights.date, date)),
                });

                // Already written: don't pay for a second horoscope, and don't replace text
                // the user may already be reading.
                if (!existing?.deepInsight) {
                    const transitData = await getOrCreateTransits(fastify.db, date);
                    const score = scoreProfileForDate(session.profile, transitData.planets);

                    const transits: DailyTransits = {
                        planets: transitData.planets as DailyTransits["planets"],
                        aspects: transitData.aspects as DailyTransits["aspects"],
                    };

                    const insight = await generateDailyInsight({
                        goals: session.profile.goalsForTheYear,
                        languageIso: session.profile.language,
                        moonSign: session.profile.moonSign,
                        priorities: session.profile.areasOfInterest,
                        relationshipStatus: session.profile.relationshipStatus,
                        sunSign: session.profile.sunSign,
                        transits,
                        score,
                    });

                    const row = {
                        date,
                        userId: session.user.id,
                        overview: insight.overview,
                        moon: insight.moon,
                        loveScore: insight.insights.love.score,
                        loveInsight: insight.insights.love,
                        careerScore: insight.insights.career.score,
                        careerInsight: insight.insights.career,
                        healthScore: insight.insights.health.score,
                        healthInsight: insight.insights.health,
                        moodScore: insight.insights.mood.score,
                        moodInsight: insight.insights.mood,
                        overallScore: insight.insights.overall.score,
                        overallInsight: insight.insights.overall,
                        opportunity: insight.opportunity,
                        watchOut: insight.watchOut,
                        deepInsight: insight.deepInsight,
                        rawScores: score.raw,
                        confidence: score.confidence,
                        scoreBreakdown: score.breakdown,
                        engineVersion: ENGINE_VERSION,
                        calibrationVersion: CALIBRATION_VERSION,
                        rawResponse: insight.rawResponse,
                        rawInput: insight.rawInput,
                    };

                    /**
                     * `setWhere` makes the write conditional: insert when the day has no
                     * row, fill in the text when the row holds scores only, and do nothing
                     * when a concurrent generate already wrote one. Two requests that race
                     * both produce valid text, and the loser must not replace the winner's.
                     */
                    await fastify.db
                        .insert(dailyInsights)
                        .values(row)
                        .onConflictDoUpdate({
                            target: [dailyInsights.userId, dailyInsights.date],
                            set: row,
                            setWhere: isNull(dailyInsights.deepInsight),
                        });
                }

                const data = await buildResponse(fastify.db, {
                    userId: session.user.id,
                    profile: session.profile,
                    date,
                });

                return reply.status(200).send({ data });
            } catch (error: unknown) {
                const isDev = process.env.NODE_ENV !== "production";

                request.log.error({ err: error }, "Failed to generate daily insight");

                return reply.status(500).send({
                    error: {
                        code: "error",
                        message:
                            isDev && error instanceof Error ? (error.stack ?? error.message) : "Internal Server Error",
                    },
                });
            }
        }
    );
}) satisfies FastifyPluginAsync;
