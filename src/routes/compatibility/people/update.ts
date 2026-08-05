import { fromNodeHeaders } from "better-auth/node";
import dayjs from "dayjs";
import { and, eq } from "drizzle-orm";
import { FastifyPluginAsync } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { find as geoTz } from "geo-tz";
import { z } from "zod";

import { compatibilityPeople, compatibilityPeopleScores, transit } from "../../../db/schema";
import { auth } from "../../../lib/auth";
import { computeNatalChart, EphemerisError } from "../../../modules/astro";
import { calculateCompatibility, calculateDailyCompatibility } from "../../../modules/compatibilityPeople/aspects";
import { BASE_NORMALIZER, normalizeScore, OVERALL_NORMALIZER } from "../../../modules/compatibilityPeople/normalizer";
import { serializeDrizzleData, takeUniqueOrThrow } from "../../../utils/drizzleUtils";
import { Genders, getSunSign, Relationships, ZodiacSign } from "../../../utils/natalUtils";
import { MIN_AGE } from "../../profile/add";

export default (async (fastify) => {
    fastify.withTypeProvider<ZodTypeProvider>().post(
        "/update",
        {
            schema: {
                body: z.object({
                    id: z.string(),
                    name: z.string().min(1, "Name is required").max(60, "Name must be at most 60 characters long"),
                    relationship: z.enum(Relationships, { message: "Relationship is invalid" }),
                    gender: z.enum(Genders, { message: "Gender is invalid" }),
                    birthDate: z
                        .string()
                        .refine((date) => dayjs(date).isValid(), { message: "Birth date is invalid" })
                        .refine((date) => dayjs(date).isSameOrBefore(dayjs().subtract(MIN_AGE, "year"), "day"), {
                            message: `You must be at least ${MIN_AGE} years old`,
                        }),
                    birthTime: z.string().nullable(),
                    birthPlace: z.string().nullable(),
                    birthPlaceLat: z.number().nullable(),
                    birthPlaceLng: z.number().nullable(),
                }),
                response: {
                    200: z.object({
                        data: z.object({
                            compatibilityPersonId: z.string(),
                        }),
                    }),
                    401: z.object({
                        error: z.object({
                            code: z.string(),
                            message: z.string(),
                        }),
                    }),
                    404: z.object({
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
                // Get sun sign from birth date
                const sunSign: ZodiacSign = getSunSign(dayjs(request.body.birthDate).toDate()).name;

                // Use today's date
                const date = dayjs().format("YYYY-MM-DD");

                // Use timezone from session if available
                let timezone = session.profile.timezone;

                // If birthPlace is provided, use detected timezone
                if (
                    request.body.birthPlace &&
                    request.body.birthPlaceLat !== null &&
                    request.body.birthPlaceLng !== null
                ) {
                    const detectedTimezone = geoTz(request.body.birthPlaceLat, request.body.birthPlaceLng)[0];
                    if (detectedTimezone) {
                        // Use detected timezone
                        timezone = detectedTimezone;
                    }
                }

                // Compute birth chart: 10 planets, plus the Ascendant when the birth time is known
                const { chart: birthChart } = computeNatalChart({
                    birthDate: request.body.birthDate,
                    birthTime: request.body.birthTime,
                    birthPlaceLat: request.body.birthPlaceLat,
                    birthPlaceLng: request.body.birthPlaceLng,
                    timezone,
                });

                // Compute moon sign
                const moonSign: ZodiacSign = birthChart.moon.sign;

                // null without a birth time — an Ascendant derived from an assumed noon is meaningless
                const risingSign: ZodiacSign | null = birthChart.ascendant?.sign ?? null;

                // Get transits for today
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

                // Compute base compatibility between the person and the current user
                const baseCompatibility = calculateCompatibility(session.profile.birthChart, birthChart);

                // Compute daily compatibility between the person and the current user
                const dailyCompatibility = calculateDailyCompatibility(
                    transits.planets,
                    session.profile.birthChart,
                    birthChart
                );

                // Compute overall raw score
                const overallRaw = baseCompatibility.overall + dailyCompatibility.modifier;

                // Compute normalized scores
                const baseScore = normalizeScore(baseCompatibility.overall, BASE_NORMALIZER);
                const overallScore = normalizeScore(overallRaw, OVERALL_NORMALIZER);

                const compatibilityPersonId = await fastify.db.transaction(async (tx) => {
                    // Get previous compatibility score
                    const { prevBaseScore, prevOverallScore } = serializeDrizzleData(
                        await tx
                            .select({
                                prevBaseScore: compatibilityPeople.baseScore,
                                prevOverallScore: compatibilityPeopleScores.score,
                            })
                            .from(compatibilityPeople)
                            .innerJoin(
                                compatibilityPeopleScores,
                                and(
                                    eq(compatibilityPeopleScores.personId, request.body.id),
                                    eq(compatibilityPeopleScores.date, date)
                                )
                            )
                            .where(
                                and(
                                    eq(compatibilityPeople.id, request.body.id),
                                    eq(compatibilityPeople.userId, session.user.id)
                                )
                            )
                            .then(takeUniqueOrThrow)
                    );

                    // Save compatibility person to database
                    const { id } = await tx
                        .update(compatibilityPeople)
                        .set({
                            userId: session.user.id,
                            name: request.body.name,
                            gender: request.body.gender,
                            relationship: request.body.relationship,
                            birthDate: dayjs(request.body.birthDate).format("YYYY-MM-DD"),
                            birthTime: request.body.birthTime ? dayjs(request.body.birthTime).format("HH:mm") : null,
                            birthPlace: request.body.birthPlace,
                            birthPlaceLat: request.body.birthPlaceLat,
                            birthPlaceLng: request.body.birthPlaceLng,
                            sunSign,
                            moonSign,
                            risingSign,
                            birthChart,
                            baseScore,
                            baseCompatibility,
                            timezone,
                        })
                        .where(
                            and(
                                eq(compatibilityPeople.id, request.body.id),
                                eq(compatibilityPeople.userId, session.user.id)
                            )
                        )
                        .returning({
                            id: compatibilityPeople.id,
                        })
                        .then(takeUniqueOrThrow);

                    // Check if the compatibility score has changed
                    if (prevBaseScore !== baseScore || prevOverallScore !== overallScore) {
                        // Delete previous compatibility insights
                        await tx
                            .update(compatibilityPeopleScores)
                            .set({
                                overview: null,
                                positiveOverview: null,
                                negativeOverview: null,
                                insights: null,
                                practicalAdvice: null,
                                rawInput: null,
                            })
                            .where(
                                and(
                                    eq(compatibilityPeopleScores.personId, request.body.id),
                                    eq(compatibilityPeopleScores.date, date)
                                )
                            );
                    }

                    // Save compatibility score to database
                    await tx
                        .insert(compatibilityPeopleScores)
                        .values({
                            date,
                            personId: id,
                            score: overallScore,
                            compatibility: dailyCompatibility,
                        })
                        .onConflictDoUpdate({
                            target: [compatibilityPeopleScores.personId, compatibilityPeopleScores.date],
                            set: {
                                score: overallScore,
                                compatibility: dailyCompatibility,
                            },
                        });

                    return id;
                });

                return reply.status(200).send({
                    data: { compatibilityPersonId },
                });
            } catch (error: unknown) {
                const isDev = process.env.NODE_ENV !== "production";

                if (error instanceof EphemerisError) {
                    request.log.error({ err: error }, "Failed to compute birth chart");

                    return reply.status(409).send({
                        error: {
                            code: "transit_calculation_error",
                            message: error.message,
                        },
                    });
                }

                request.log.error({ err: error }, "Failed to update compatibility person");

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
