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
                            horoscope: z.string(),
                            moonInsight: z.string(),
                            focus: z.string().array(),
                            caution: z.string().array(),
                            do: z.string(),
                            avoid: z.string(),
                            scoreLove: z.number(),
                            scoreCareer: z.number(),
                            scoreHealth: z.number(),
                            scoreMood: z.number(),
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
                    return reply.status(200).send({
                        data: serializeDrizzleData({
                            date: transitData.date,
                            horoscope: insightsData[0].horoscope,
                            moonInsight: insightsData[0].moonInsight,
                            focus: insightsData[0].focus,
                            caution: insightsData[0].caution,
                            do: insightsData[0].do,
                            avoid: insightsData[0].avoid,
                            scoreLove: insightsData[0].scoreLove,
                            scoreCareer: insightsData[0].scoreCareer,
                            scoreHealth: insightsData[0].scoreHealth,
                            scoreMood: insightsData[0].scoreMood,
                        }),
                    });
                }

                console.info("generating insights data");

                const date = dayjs.utc(request.query.date).format("YYYY-MM-DD");

                const transits: DailyTransits = {
                    planets: transitData.planets as DailyTransits["planets"],
                    aspects: transitData.aspects as DailyTransits["aspects"],
                };

                const result = await generateDailyInsight({
                    sunSign: session.profile.sunSign,
                    moonSign: session.profile.moonSign,
                    transits: transits,
                    // contentPreference: session.profile.contentPreference,
                    // priorities: session.profile.areasOfInterest,
                    // goals: session.profile.goalsForTheYear,
                    // relationshipStatus: session.profile.relationshipStatus,
                    language: session.profile.language,
                });

                await fastify.db.insert(dailyInsights).values({
                    date: dayjs.utc(request.query.date).format("YYYY-MM-DD"),
                    userId: session.user.id,
                    horoscope: result.horoscope,
                    moonInsight: result.moonInsight,
                    focus: result.focus,
                    caution: result.caution,
                    do: result.do,
                    avoid: result.avoid,
                    scoreLove: result.scores.love,
                    scoreCareer: result.scores.career,
                    scoreHealth: result.scores.health,
                    scoreMood: result.scores.mood,
                });

                return reply.status(200).send({
                    data: {
                        date: transitData.date,
                        horoscope: result.horoscope,
                        moonInsight: result.moonInsight,
                        focus: result.focus,
                        caution: result.caution,
                        do: result.do,
                        avoid: result.avoid,
                        scoreLove: result.scores.love,
                        scoreCareer: result.scores.career,
                        scoreHealth: result.scores.health,
                        scoreMood: result.scores.mood,
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
