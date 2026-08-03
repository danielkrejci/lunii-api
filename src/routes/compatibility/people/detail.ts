import { fromNodeHeaders } from "better-auth/node";
import dayjs from "dayjs";
import { and, eq } from "drizzle-orm";
import { FastifyPluginAsync } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { compatibilityPeople, compatibilityPeopleScores, transit } from "../../../db/schema";
import { auth } from "../../../lib/auth";
import { DailyOverviewResponse, generateDailyOverview } from "../../../modules/compatibilityPeople/ai";
import { serializeDrizzleData, takeUniqueOrThrow } from "../../../utils/drizzleUtils";
import { Genders, Relationships, SINGS_MAP } from "../../../utils/natalUtils";

export default (async (fastify) => {
    fastify.withTypeProvider<ZodTypeProvider>().get(
        "/detail",
        {
            schema: {
                querystring: z.object({
                    compatibilityPersonId: z.string().min(1),
                    date: z.string().refine((date) => dayjs(date).isValid(), { message: "Date is invalid" }),
                }),
                response: {
                    200: z.object({
                        data: z.object({
                            id: z.string(),
                            name: z.string(),
                            gender: z.enum(Genders),
                            relationship: z.enum(Relationships),
                            birthDate: z.string(),
                            birthTime: z.string().nullable(),
                            birthPlace: z.string().nullable(),
                            birthPlaceLat: z.number().nullable(),
                            birthPlaceLng: z.number().nullable(),
                            sign: z.enum(SINGS_MAP),
                            image: z.string().nullable(),
                            baseCompatibility: z.any(),
                            baseScore: z.number(),
                            compatibility: z.any(),
                            score: z.number(),
                            overview: z.string(),
                            positiveOverview: z.object({
                                title: z.string(),
                                description: z.string(),
                                reason: z.string(),
                            }),
                            negativeOverview: z.object({
                                title: z.string(),
                                description: z.string(),
                                reason: z.string(),
                            }),
                            insights: z.array(
                                z.object({
                                    title: z.string(),
                                    description: z.string(),
                                    reason: z.string(),
                                    category: z.string(),
                                    direction: z.string(),
                                })
                            ),
                            practicalAdvice: z.string(),
                            date: z.string(),
                        }),
                    }),
                    401: z.object({
                        error: z.object({
                            code: z.string(),
                            message: z.string(),
                        }),
                    }),
                    409: z.object({
                        error: z.object({
                            code: z.string(),
                            message: z.string(),
                        }),
                    }),
                    500: z.object({
                        error: z.object({
                            code: z.string(),
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

            if (!session) {
                return reply.status(401).send({
                    error: {
                        code: "unauthorized",
                        message: "User must be logged in to access this resource.",
                    },
                });
            }

            if (!session.profile) {
                return reply.status(409).send({
                    error: {
                        code: "profile_required",
                        message: "User must complete onboarding before accessing this resource.",
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
                    return reply.status(409).send({
                        error: {
                            code: "transit_not_found",
                            message: "No transits found for this date",
                        },
                    });
                }

                const person = await fastify.db
                    .select({
                        id: compatibilityPeople.id,
                        name: compatibilityPeople.name,
                        gender: compatibilityPeople.gender,
                        relationship: compatibilityPeople.relationship,
                        birthDate: compatibilityPeople.birthDate,
                        birthTime: compatibilityPeople.birthTime,
                        birthPlace: compatibilityPeople.birthPlace,
                        birthPlaceLat: compatibilityPeople.birthPlaceLat,
                        birthPlaceLng: compatibilityPeople.birthPlaceLng,
                        sign: compatibilityPeople.sunSign,
                        image: compatibilityPeople.image,
                        birthChart: compatibilityPeople.birthChart,
                        baseCompatibility: compatibilityPeople.baseCompatibility,
                        baseScore: compatibilityPeople.baseScore,
                        score: compatibilityPeopleScores.score,
                        compatibility: compatibilityPeopleScores.compatibility,
                        overview: compatibilityPeopleScores.overview,
                        positiveOverview: compatibilityPeopleScores.positiveOverview,
                        negativeOverview: compatibilityPeopleScores.negativeOverview,
                        insights: compatibilityPeopleScores.insights,
                        practicalAdvice: compatibilityPeopleScores.practicalAdvice,
                        date: compatibilityPeopleScores.date,
                    })
                    .from(compatibilityPeople)
                    .innerJoin(
                        compatibilityPeopleScores,
                        and(
                            eq(compatibilityPeopleScores.personId, compatibilityPeople.id),
                            eq(compatibilityPeopleScores.date, date)
                        )
                    )
                    .where(
                        and(
                            eq(compatibilityPeople.id, request.query.compatibilityPersonId),
                            eq(compatibilityPeople.userId, session.user.id)
                        )
                    )
                    .then(takeUniqueOrThrow);

                // 0–19	Very Challenging
                // 20–39	Challenging
                // 40–59	Balanced
                // 60–79	Strong
                // 80–100	Exceptional

                if (
                    !person.overview ||
                    !person.positiveOverview ||
                    !person.negativeOverview ||
                    !person.insights ||
                    !person.practicalAdvice
                ) {
                    const language = session.profile.language;

                    const { response: dailyOverview, input: rawInput } = await generateDailyOverview(language, {
                        score: person.score,
                        modifier: person.compatibility.modifier,

                        positiveTotal: person.compatibility.positiveOverall,
                        negativeTotal: person.compatibility.negativeOverall,

                        breakdown: person.compatibility.overallBreakdown,

                        positiveAspects: person.compatibility.positiveAspects.map(({ rule, score }) => ({
                            title: rule.title,
                            description: rule.description,
                            category: rule.category,
                            planetA: rule.planetA,
                            planetB: rule.planetB,
                            score,
                        })),
                        negativeAspects: person.compatibility.negativeAspects.map(({ rule, score }) => ({
                            title: rule.title,
                            description: rule.description,
                            category: rule.category,
                            planetA: rule.planetA,
                            planetB: rule.planetB,
                            score,
                        })),

                        relationshipType: person.relationship,

                        personA: {
                            name: session.profile.name,
                            gender: session.profile.gender,
                            sunSign: session.profile.sunSign,
                        },

                        personB: {
                            name: person.name,
                            gender: person.gender,
                            sunSign: person.sign,
                        },
                    });

                    await fastify.db
                        .update(compatibilityPeopleScores)
                        .set({
                            overview: dailyOverview.overview,
                            positiveOverview: dailyOverview.positiveOverview,
                            negativeOverview: dailyOverview.negativeOverview,
                            insights: dailyOverview.insights,
                            practicalAdvice: dailyOverview.practicalAdvice,
                            rawInput,
                        })
                        .where(
                            and(
                                eq(compatibilityPeopleScores.personId, person.id),
                                eq(compatibilityPeopleScores.date, person.date)
                            )
                        );

                    person.overview = dailyOverview.overview;
                    person.positiveOverview = dailyOverview.positiveOverview;
                    person.negativeOverview = dailyOverview.negativeOverview;
                    person.insights = dailyOverview.insights;
                    person.practicalAdvice = dailyOverview.practicalAdvice;
                }

                type PersonWithOverview = Omit<
                    typeof person,
                    "overview" | "positiveOverview" | "negativeOverview" | "practicalAdvice" | "insights"
                > &
                    DailyOverviewResponse;

                const resultPerson = person as PersonWithOverview;

                return reply.status(200).send({
                    data: serializeDrizzleData({
                        id: resultPerson.id,
                        name: resultPerson.name,
                        gender: resultPerson.gender,
                        relationship: resultPerson.relationship,
                        birthDate: resultPerson.birthDate,
                        birthTime: resultPerson.birthTime,
                        birthPlace: resultPerson.birthPlace,
                        birthPlaceLat: resultPerson.birthPlaceLat,
                        birthPlaceLng: resultPerson.birthPlaceLng,
                        sign: resultPerson.sign,
                        image: resultPerson.image,
                        baseCompatibility: resultPerson.baseCompatibility,
                        baseScore: resultPerson.baseScore,
                        compatibility: resultPerson.compatibility,
                        score: resultPerson.score,
                        overview: resultPerson.overview,
                        positiveOverview: resultPerson.positiveOverview,
                        negativeOverview: resultPerson.negativeOverview,
                        insights: resultPerson.insights,
                        practicalAdvice: resultPerson.practicalAdvice,
                        date: resultPerson.date,
                    }),
                });
            } catch (error: unknown) {
                const isDev = process.env.NODE_ENV !== "production";

                request.log.error({ err: error }, "Failed to get compatibility person");

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
