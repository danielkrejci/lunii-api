import { fromNodeHeaders } from "better-auth/node";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import { and, eq } from "drizzle-orm";
import { FastifyPluginAsync } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { dailyInsights, transit } from "../db/schema";
import { auth } from "../lib/auth";
import { DailyTransits, generateDailyInsight } from "../modules/insights";
import { serializeDrizzleData, takeUniqueOrThrow } from "../utils/drizzleUtils";

dayjs.extend(utc);

export default (async (fastify) => {
    fastify.withTypeProvider<ZodTypeProvider>().get(
        "/daily-insight",
        {
            schema: {
                querystring: z.object({
                    date: z.string().refine((val) => dayjs.utc(val).isValid(), {
                        message: "Invalid date format",
                    }),
                }),
                response: {
                    200: z.object({
                        data: z.object({
                            date: z.string(),
                            overview: z.object({
                                title: z.string(),
                                description: z.string(),
                            }),
                            moon: z.object({
                                phase: z.string(),
                                insight: z.string(),
                                reason: z.string(),
                            }),
                            insights: z.object({
                                love: z.object({
                                    score: z.number(),
                                    insight: z.string(),
                                    reason: z.string(),
                                }),
                                career: z.object({
                                    score: z.number(),
                                    insight: z.string(),
                                    reason: z.string(),
                                }),
                                health: z.object({
                                    score: z.number(),
                                    insight: z.string(),
                                    reason: z.string(),
                                }),
                                mood: z.object({
                                    score: z.number(),
                                    insight: z.string(),
                                    reason: z.string(),
                                }),
                            }),
                            opportunity: z.object({
                                description: z.string(),
                                examples: z.array(z.string()),
                            }),
                            watchOut: z.object({
                                description: z.string(),
                                examples: z.array(z.string()),
                            }),
                            deepInsight: z.string(),
                        }),
                    }),
                    400: z.object({
                        error: z.object({
                            message: z.string(),
                        }),
                    }),
                    401: z.object({
                        error: z.object({
                            message: z.string(),
                        }),
                    }),
                    404: z.object({
                        error: z.object({
                            message: z.string(),
                        }),
                    }),
                },
            },
        },
        async (request, reply) => {
            const session = await auth.api.getSession({
                headers: fromNodeHeaders(request.headers),
            });

            if (!session || !session.profile) {
                return reply.status(401).send({
                    error: {
                        message: "Unauthorized",
                    },
                });
            }

            try {
                const transitData = await fastify.db
                    .select()
                    .from(transit)
                    .where(eq(transit.date, request.query.date))
                    .then(takeUniqueOrThrow);

                if (!transitData) {
                    return reply.status(404).send({
                        error: {
                            message: "No transits found for this date",
                        },
                    });
                }

                const insightsData = await fastify.db
                    .select()
                    .from(dailyInsights)
                    .where(and(eq(dailyInsights.userId, session.user.id), eq(dailyInsights.date, request.query.date)));

                if (insightsData.length > 0) {
                    console.info("using cached insights");

                    const result = insightsData[0];
                    // await new Promise((resolve) => setTimeout(resolve, 3000));

                    return reply.status(200).send({
                        data: serializeDrizzleData({
                            date: transitData.date,
                            overview: result.overview,
                            moon: result.moon,
                            insights: {
                                love: {
                                    score: result.loveInsight.score,
                                    insight: result.loveInsight.insight,
                                    reason: result.loveInsight.reason,
                                },
                                career: {
                                    score: result.careerInsight.score,
                                    insight: result.careerInsight.insight,
                                    reason: result.careerInsight.reason,
                                },
                                health: {
                                    score: result.healthInsight.score,
                                    insight: result.healthInsight.insight,
                                    reason: result.healthInsight.reason,
                                },
                                mood: {
                                    score: result.moodInsight.score,
                                    insight: result.moodInsight.insight,
                                    reason: result.moodInsight.reason,
                                },
                            },
                            opportunity: result.opportunity,
                            watchOut: result.watchOut,
                            deepInsight: result.deepInsight,
                        }),
                    });
                }

                console.info("generating insights data...");

                const transits: DailyTransits = {
                    planets: transitData.planets as DailyTransits["planets"],
                    aspects: transitData.aspects as DailyTransits["aspects"],
                };

                const result = await generateDailyInsight({
                    goals: session.profile.goalsForTheYear,
                    language: session.profile.language,
                    moonSign: session.profile.moonSign,
                    priorities: session.profile.areasOfInterest,
                    relationshipStatus: session.profile.relationshipStatus,
                    sunSign: session.profile.sunSign,
                    transits: transits,
                });

                await fastify.db.insert(dailyInsights).values({
                    date: dayjs.utc(request.query.date).format("YYYY-MM-DD"),
                    userId: session.user.id,
                    overview: result.overview,
                    moon: result.moon,
                    loveScore: result.insights.love.score,
                    loveInsight: result.insights.love,
                    careerScore: result.insights.career.score,
                    careerInsight: result.insights.career,
                    healthScore: result.insights.health.score,
                    healthInsight: result.insights.health,
                    moodScore: result.insights.mood.score,
                    moodInsight: result.insights.mood,
                    opportunity: result.opportunity,
                    watchOut: result.watchOut,
                    deepInsight: result.deepInsight,
                    rawResponse: result.rawResponse,
                    rawInput: result.rawInput,
                });

                return reply.status(200).send({
                    data: {
                        date: transitData.date,
                        overview: result.overview,
                        moon: result.moon,
                        insights: {
                            love: {
                                score: result.insights.love.score,
                                insight: result.insights.love.insight,
                                reason: result.insights.love.reason,
                            },
                            career: {
                                score: result.insights.career.score,
                                insight: result.insights.career.insight,
                                reason: result.insights.career.reason,
                            },
                            health: {
                                score: result.insights.health.score,
                                insight: result.insights.health.insight,
                                reason: result.insights.health.reason,
                            },
                            mood: {
                                score: result.insights.mood.score,
                                insight: result.insights.mood.insight,
                                reason: result.insights.mood.reason,
                            },
                        },
                        opportunity: result.opportunity,
                        watchOut: result.watchOut,
                        deepInsight: result.deepInsight,
                    },
                });
            } catch (e: any) {
                return reply.status(400).send({
                    error: {
                        message: "detail" in e ? e.detail : "message" in e ? e.message : "Error",
                    },
                });
            }
        }
    );
}) satisfies FastifyPluginAsync;
