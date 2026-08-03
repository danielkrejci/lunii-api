import { fromNodeHeaders } from "better-auth/node";
import dayjs from "dayjs";
import { and, eq } from "drizzle-orm";
import { FastifyPluginAsync } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { find as geoTz } from "geo-tz";
import { z } from "zod";

import { compatibilityPeople, compatibilityPeopleScores, transit } from "../../../db/schema";
import { auth } from "../../../lib/auth";
import swisseph from "../../../lib/swisseph";
import { calculateCompatibility, calculateDailyCompatibility } from "../../../modules/compatibilityPeople/aspects";
import { BASE_NORMALIZER, normalizeScore, OVERALL_NORMALIZER } from "../../../modules/compatibilityPeople/normalizer";
import { NatalChart } from "../../../modules/compatibilityPeople/types";
import { getPlanetPosition } from "../../../modules/transits";
import { serializeDrizzleData, takeUniqueOrThrow } from "../../../utils/drizzleUtils";
import { Genders, getSunSign, Relationships, SINGS_MAP, ZodiacSign } from "../../../utils/natalUtils";
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

                const birthDate = dayjs(request.body.birthDate);
                const birthTime = request.body.birthTime ? dayjs(request.body.birthTime) : dayjs().hour(12).minute(0);

                // Compute absolute birth date
                const absoluteBirthDate = dayjs
                    .tz(birthDate.format("YYYY-MM-DD"), timezone)
                    .hour(birthTime.hour())
                    .minute(birthTime.minute())
                    .second(0)
                    .millisecond(0)
                    .toDate();

                // Compute julian day
                const jd = swisseph.swe_julday(
                    absoluteBirthDate.getUTCFullYear(),
                    absoluteBirthDate.getUTCMonth() + 1,
                    absoluteBirthDate.getUTCDate(),
                    absoluteBirthDate.getUTCHours() + absoluteBirthDate.getUTCMinutes() / 60,
                    swisseph.SE_GREG_CAL
                );

                // Compute birth chart
                const birthChart: NatalChart = {
                    sun: getPlanetPosition(jd, swisseph.SE_SUN),
                    moon: getPlanetPosition(jd, swisseph.SE_MOON),
                    mercury: getPlanetPosition(jd, swisseph.SE_MERCURY),
                    venus: getPlanetPosition(jd, swisseph.SE_VENUS),
                    mars: getPlanetPosition(jd, swisseph.SE_MARS),
                    jupiter: getPlanetPosition(jd, swisseph.SE_JUPITER),
                    saturn: getPlanetPosition(jd, swisseph.SE_SATURN),
                };

                // Compute moon sign
                const moonSign: ZodiacSign = birthChart.moon.sign;

                let risingSign: ZodiacSign | null = null;

                if (request.body.birthPlaceLat !== null && request.body.birthPlaceLng !== null) {
                    // Compute risign sign
                    const houses = swisseph.swe_houses(jd, request.body.birthPlaceLat, request.body.birthPlaceLng, "P");

                    if ("error" in houses) {
                        return reply.status(400).send({ error: { message: houses.error } });
                    }

                    risingSign = SINGS_MAP[Math.floor(houses.ascendant / 30)];
                }

                // Get transits for today
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
