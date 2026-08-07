import { fromNodeHeaders } from "better-auth/node";
import dayjs from "dayjs";
import timezonePlugin from "dayjs/plugin/timezone.js";
import utc from "dayjs/plugin/utc.js";
import { FastifyPluginAsync } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { find as geoTz } from "geo-tz";
import { z } from "zod";

import { compatibilityPeople, compatibilityPeopleScores } from "../../../db/schema";
import { auth } from "../../../lib/auth";
import { computeNatalChart, EphemerisError } from "../../../modules/astro";
import { calculateCompatibility, calculateDailyCompatibility } from "../../../modules/compatibilityPeople/aspects";
import { BASE_NORMALIZER, normalizeScore, OVERALL_NORMALIZER } from "../../../modules/compatibilityPeople/normalizer";
import { getOrCreateTransits } from "../../../modules/dailyScore/service";
import { takeUniqueOrThrow } from "../../../utils/drizzleUtils";
import { Genders, getSunSign, Relationships, ZodiacSign } from "../../../utils/natalUtils";
import { MIN_AGE } from "../../profile/add";

dayjs.extend(utc);
dayjs.extend(timezonePlugin);

export default (async (fastify) => {
    fastify.withTypeProvider<ZodTypeProvider>().post(
        "/add",
        {
            schema: {
                body: z.object({
                    name: z.string().min(1, "Name is required").max(60, "Name must be at most 60 characters long"),
                    relationship: z.enum(Relationships, { message: "Relationship is invalid" }),
                    gender: z.enum(Genders, { message: "Gender is invalid" }),
                    /** Wall clock, not an instant — see profile/add for why. */
                    birthDate: z
                        .string()
                        .regex(/^\d{4}-\d{2}-\d{2}$/u, "Birth date must be YYYY-MM-DD.")
                        .refine((date) => dayjs(date).isSameOrBefore(dayjs().subtract(MIN_AGE, "year"), "day"), {
                            message: `You must be at least ${MIN_AGE} years old`,
                        }),
                    birthTime: z
                        .string()
                        .regex(/^\d{2}:\d{2}$/u, "Birth time must be HH:mm.")
                        .nullable(),
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

                // The user own today, not the server one: in Auckland it is already
                // tomorrow while Germany is still asleep, and the app asks for the date
                // its own clock shows.
                const date = dayjs()
                    .tz(session.profile.timezone ?? "UTC")
                    .format("YYYY-MM-DD");

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

                // compute birth chart: 10 planets, plus the Ascendant when the birth time is known
                const { chart: birthChart } = computeNatalChart({
                    birthDate: request.body.birthDate,
                    birthTime: request.body.birthTime,
                    birthPlaceLat: request.body.birthPlaceLat,
                    birthPlaceLng: request.body.birthPlaceLng,
                    timezone,
                });

                // compute moon sign
                const moonSign: ZodiacSign = birthChart.moon.sign;

                // null without a birth time — an Ascendant derived from an assumed noon is meaningless
                const risingSign: ZodiacSign | null = birthChart.ascendant?.sign ?? null;

                // Sampled at local noon of the user own zone, so a date means the same
                // span of time here as it does on their screen.
                const transits = await getOrCreateTransits(fastify.db, date, session.profile.timezone);

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
                            birthDate: request.body.birthDate,
                            birthTime: request.body.birthTime,
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

                if (error instanceof EphemerisError) {
                    request.log.error({ err: error }, "Failed to compute birth chart");

                    return reply.status(409).send({
                        error: {
                            code: "transit_calculation_error",
                            message: error.message,
                        },
                    });
                }

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
