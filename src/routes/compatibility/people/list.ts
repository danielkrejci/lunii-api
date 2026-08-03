import { fromNodeHeaders } from "better-auth/node";
import dayjs from "dayjs";
import { and, desc, eq } from "drizzle-orm";
import { FastifyPluginAsync } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { compatibilityPeople, compatibilityPeopleScores, transit } from "../../../db/schema";
import { auth } from "../../../lib/auth";
import { calculateDailyCompatibility } from "../../../modules/compatibilityPeople/aspects";
import { normalizeScore, OVERALL_NORMALIZER } from "../../../modules/compatibilityPeople/normalizer";
import { serializeDrizzleData, takeUniqueOrThrow } from "../../../utils/drizzleUtils";
import { SINGS_MAP } from "../../../utils/natalUtils";

export default (async (fastify) => {
    fastify.withTypeProvider<ZodTypeProvider>().get(
        "/list",
        {
            schema: {
                querystring: z.object({
                    date: z.string().refine((val) => dayjs.utc(val).isValid(), {
                        message: "Invalid date format",
                    }),
                }),
                response: {
                    200: z.object({
                        data: z.array(
                            z.object({
                                id: z.string(),
                                name: z.string(),
                                sign: z.enum(SINGS_MAP),
                                image: z.string().nullable(),
                                score: z.number(),
                                compatibility: z.any(),
                                date: z.string(),
                                baseCompatibility: z.any(),
                                baseScore: z.number(),
                                birthChart: z.any(),
                            })
                        ),
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
                    500: z.object({
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
                const date = dayjs.utc(request.query.date).format("YYYY-MM-DD");

                const transits = await fastify.db
                    .select()
                    .from(transit)
                    .where(eq(transit.date, date))
                    .then(takeUniqueOrThrow);

                if (!transits) {
                    return reply.status(404).send({
                        error: {
                            message: "No transits found for this date",
                        },
                    });
                }

                const people = await fastify.db
                    .select({
                        id: compatibilityPeople.id,
                        name: compatibilityPeople.name,
                        sign: compatibilityPeople.sunSign,
                        image: compatibilityPeople.image,
                        baseCompatibility: compatibilityPeople.baseCompatibility,
                        baseScore: compatibilityPeople.baseScore,
                        birthChart: compatibilityPeople.birthChart,
                        score: compatibilityPeopleScores.score,
                        compatibility: compatibilityPeopleScores.compatibility,
                        date: compatibilityPeopleScores.date,
                    })
                    .from(compatibilityPeople)
                    .leftJoin(
                        compatibilityPeopleScores,
                        and(
                            eq(compatibilityPeopleScores.personId, compatibilityPeople.id),
                            eq(compatibilityPeopleScores.date, date)
                        )
                    )
                    .where(eq(compatibilityPeople.userId, session.user.id))
                    .orderBy(desc(compatibilityPeople.createdAt))
                    .limit(20);

                const missingScores = people.filter((p) => p.score === null);

                for (const person of missingScores) {
                    const dailyCompatibility = calculateDailyCompatibility(
                        transits.planets,
                        session.profile.birthChart,
                        person.birthChart
                    );

                    const overallRaw = person.baseCompatibility.overall + dailyCompatibility.modifier;

                    const overallScore = normalizeScore(overallRaw, OVERALL_NORMALIZER);

                    await fastify.db.insert(compatibilityPeopleScores).values({
                        personId: person.id,
                        date,
                        score: overallScore,
                        compatibility: dailyCompatibility,
                    });

                    person.date = date;
                    person.score = overallScore;
                    person.compatibility = dailyCompatibility;
                }

                type PersonWithScore = Omit<(typeof people)[number], "score" | "date"> & {
                    score: number;
                    date: string;
                };

                const sortedPeople = (people as unknown as PersonWithScore[]).sort((a, b) => b.score - a.score);

                return reply.status(200).send({
                    data: serializeDrizzleData(sortedPeople),
                });
            } catch (error: unknown) {
                const isDev = process.env.NODE_ENV !== "production";

                request.log.error({ err: error }, "Failed to list compatibility people");

                return reply.status(500).send({
                    error: {
                        message:
                            isDev && error instanceof Error ? (error.stack ?? error.message) : "Internal Server Error",
                    },
                });
            }
        }
    );
}) satisfies FastifyPluginAsync;
