import { fromNodeHeaders } from "better-auth/node";
import dayjs from "dayjs";
import { eq } from "drizzle-orm";
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
import { takeUniqueOrThrow } from "../../../utils/drizzleUtils";
import { Genders, getSunSign, Relationships, SINGS_MAP, ZodiacSign } from "../../../utils/natalUtils";
import { MIN_AGE } from "../../profile/add";

export default (async (fastify) => {
    fastify.withTypeProvider<ZodTypeProvider>().post(
        "/add",
        {
            schema: {
                body: z.object({
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
                // get sun sign from birth date
                const sunSign: ZodiacSign = getSunSign(dayjs(request.body.birthDate).toDate()).name;

                // use today's date
                const date = dayjs().format("YYYY-MM-DD");

                // use timezone from session if available
                let timezone = session.profile.timezone;

                // if birthPlace is provided, use detected timezone
                if (
                    request.body.birthPlace &&
                    request.body.birthPlaceLat !== null &&
                    request.body.birthPlaceLng !== null
                ) {
                    const detectedTimezone = geoTz(request.body.birthPlaceLat, request.body.birthPlaceLng)[0];
                    if (detectedTimezone) {
                        // use detected timezone
                        timezone = detectedTimezone;
                    }
                }

                const birthDate = dayjs(request.body.birthDate);
                const birthTime = request.body.birthTime ? dayjs(request.body.birthTime) : dayjs().hour(12).minute(0);

                // compute absolute birth date
                const absoluteBirthDate = dayjs
                    .tz(birthDate.format("YYYY-MM-DD"), timezone)
                    .hour(birthTime.hour())
                    .minute(birthTime.minute())
                    .second(0)
                    .millisecond(0)
                    .toDate();

                // compute julian day
                const jd = swisseph.swe_julday(
                    absoluteBirthDate.getUTCFullYear(),
                    absoluteBirthDate.getUTCMonth() + 1,
                    absoluteBirthDate.getUTCDate(),
                    absoluteBirthDate.getUTCHours() + absoluteBirthDate.getUTCMinutes() / 60,
                    swisseph.SE_GREG_CAL
                );

                // compute birth chart
                const birthChart: NatalChart = {
                    sun: getPlanetPosition(jd, swisseph.SE_SUN),
                    moon: getPlanetPosition(jd, swisseph.SE_MOON),
                    mercury: getPlanetPosition(jd, swisseph.SE_MERCURY),
                    venus: getPlanetPosition(jd, swisseph.SE_VENUS),
                    mars: getPlanetPosition(jd, swisseph.SE_MARS),
                    jupiter: getPlanetPosition(jd, swisseph.SE_JUPITER),
                    saturn: getPlanetPosition(jd, swisseph.SE_SATURN),
                };

                // compute moon sign
                const moonSign: ZodiacSign = birthChart.moon.sign;

                let risingSign: ZodiacSign | null = null;

                if (request.body.birthPlaceLat !== null && request.body.birthPlaceLng !== null) {
                    // compute risign sign
                    const houses = swisseph.swe_houses(jd, request.body.birthPlaceLat, request.body.birthPlaceLng, "P");

                    if ("error" in houses) {
                        return reply.status(409).send({
                            error: {
                                code: "transit_calculation_error",
                                message: houses.error,
                            },
                        });
                    }

                    risingSign = SINGS_MAP[Math.floor(houses.ascendant / 30)];
                }

                // get transits for today
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

                // compute base compatibility between the person and the current user
                const baseCompatibility = calculateCompatibility(session.profile.birthChart, birthChart);

                // compute daily compatibility between the person and the current user
                const dailyCompatibility = calculateDailyCompatibility(
                    transits.planets,
                    session.profile.birthChart,
                    birthChart
                );

                // compute overall raw score
                const overallRaw = baseCompatibility.overall + dailyCompatibility.modifier;

                // compute normalized scores
                const baseScore = normalizeScore(baseCompatibility.overall, BASE_NORMALIZER);
                const overallScore = normalizeScore(overallRaw, OVERALL_NORMALIZER);

                const compatibilityPersonId = await fastify.db.transaction(async (tx) => {
                    // save compatibility person to database
                    const { id } = await tx
                        .insert(compatibilityPeople)
                        .values({
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
                        .returning({
                            id: compatibilityPeople.id,
                        })
                        .then(takeUniqueOrThrow);

                    // save compatibility score to database
                    await tx.insert(compatibilityPeopleScores).values({
                        date,
                        personId: id,
                        score: overallScore,
                        compatibility: dailyCompatibility,
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
                        code: "error",
                        message:
                            isDev && error instanceof Error ? (error.stack ?? error.message) : "Internal Server Error",
                    },
                });
            }
        }
    );
}) satisfies FastifyPluginAsync;
