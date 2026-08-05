import { fromNodeHeaders } from "better-auth/node";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone.js";
import utc from "dayjs/plugin/utc.js";
import { eq } from "drizzle-orm";
import { FastifyPluginAsync } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { find as geoTz } from "geo-tz";
import { z } from "zod";

import { profile } from "../../db/schema";
import { auth } from "../../lib/auth";
import { computeNatalChart, EphemerisError } from "../../modules/astro";
import { backfillScoresForUser } from "../../modules/dailyScore/service";
import { Gender, Genders, SINGS_MAP, ZodiacSign } from "../../utils/natalUtils";

dayjs.extend(utc);
dayjs.extend(timezone);

export const MIN_AGE = 15;

export default (async (fastify) => {
    fastify.withTypeProvider<ZodTypeProvider>().post(
        "/add",
        {
            schema: {
                body: z.object({
                    name: z.string().min(1, "Please enter your name.").max(60, "Name must be 60 characters or fewer."),
                    referrer: z.string().min(1, "Please select an option."),
                    gender: z
                        .string()
                        .min(1, "Please select your gender.")
                        .refine((value) => Genders.includes(value as Gender), "Invalid gender."),
                    birthDate: z.string().refine(
                        (date) => {
                            const today = new Date();
                            const minDate = new Date(today.getFullYear() - MIN_AGE, today.getMonth(), today.getDate());
                            return new Date(date) <= minDate;
                        },
                        {
                            message: `You must be at least ${MIN_AGE} years old.`,
                        }
                    ),
                    birthTime: z.string().nullable(),
                    birthPlace: z.string().min(1, "Please enter your birth place."),
                    birthPlaceLat: z
                        .number()
                        .refine((value) => String(value).length > 0, "Please enter your birth place."),
                    birthPlaceLng: z
                        .number()
                        .refine((value) => String(value).length > 0, "Please enter your birth place."),
                    country: z.string().min(1, "Please select your country."),
                    language: z.string().min(1, "Please select your preferred language."),
                    sunSign: z
                        .string()
                        .min(1, "Please select your Sun sign.")
                        .refine((value) => SINGS_MAP.includes(value as ZodiacSign), "Invalid sign."),
                    moonSign: z
                        .string()
                        .min(1, "Please select your Moon sign.")
                        .refine((value) => SINGS_MAP.includes(value as ZodiacSign), "Invalid sign."),
                    // Null when the birth time is unknown — see personality-profile/generate.
                    risingSign: z
                        .string()
                        .refine((value) => SINGS_MAP.includes(value as ZodiacSign), "Invalid sign.")
                        .nullable(),
                    relationshipStatus: z.string().min(1, "Please select the option that best suits you."),
                    careerStage: z.string().min(1, "Please select the option that best suits you."),
                    decisionStyle: z.string().min(1, "Please select the option that best suits you."),
                    areasOfInterest: z
                        .array(z.string())
                        .min(1, "Please select 1 to 3 options that best suit you.")
                        .max(3, "You can select up to 3 areas of interest."),
                    goalsForTheYear: z
                        .array(z.string())
                        .min(1, "Please select 1 to 3 goals for this year.")
                        .max(3, "You can select up to 3 goals for this year."),
                    contentPreference: z.string().min(1, "Please select your content preference."),
                    beliefLevel: z.string().min(1, "Please select your belief level."),
                    personalityProfile: z.string().min(1, "Please select your personality profile."),
                    personalityProfileInput: z.string().min(1, "Please select your personality profile input."),
                }),
                response: {
                    200: z.object({
                        data: z.boolean(),
                    }),
                    400: z.object({
                        error: z.object({
                            code: z.string(),
                            message: z.string(),
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
                        code: "Unauthorized",
                        message: "User must be logged in to access this resource.",
                    },
                });
            }

            try {
                // check if the user already has a profile
                const profileData = await fastify.db.select().from(profile).where(eq(profile.userId, session.user.id));

                if (profileData.length > 0) {
                    return reply.status(409).send({
                        error: {
                            code: "profile_already_exists",
                            message: "Profile already exists",
                        },
                    });
                }

                const detectedTimezone = geoTz(request.body.birthPlaceLat, request.body.birthPlaceLng)[0] || "UTC";

                // compute birth chart: 10 planets, plus the Ascendant when the birth time is known
                const { chart: birthChart } = computeNatalChart({
                    birthDate: request.body.birthDate,
                    birthTime: request.body.birthTime,
                    birthPlaceLat: request.body.birthPlaceLat,
                    birthPlaceLng: request.body.birthPlaceLng,
                    timezone: detectedTimezone,
                });

                const birthTime = request.body.birthTime ? dayjs(request.body.birthTime).format("HH:mm") : null;

                await fastify.db.insert(profile).values({
                    userId: session.user.id,
                    name: request.body.name,
                    referrer: request.body.referrer,
                    gender: request.body.gender as Gender,
                    birthDate: request.body.birthDate,
                    birthTime,
                    birthPlace: request.body.birthPlace,
                    birthPlaceLat: request.body.birthPlaceLat,
                    birthPlaceLng: request.body.birthPlaceLng,
                    country: request.body.country,
                    language: request.body.language,
                    timezone: detectedTimezone,
                    sunSign: request.body.sunSign as ZodiacSign,
                    moonSign: request.body.moonSign as ZodiacSign,
                    risingSign: request.body.risingSign as ZodiacSign,
                    relationshipStatus: request.body.relationshipStatus,
                    careerStage: request.body.careerStage,
                    decisionStyle: request.body.decisionStyle,
                    areasOfInterest: request.body.areasOfInterest,
                    goalsForTheYear: request.body.goalsForTheYear,
                    contentPreference: request.body.contentPreference,
                    beliefLevel: request.body.beliefLevel,
                    personalityProfile: request.body.personalityProfile,
                    birthChart,
                    personalityProfileInput: request.body.personalityProfileInput,
                });

                /**
                 * Fill the score window right after onboarding. The session hook in lib/auth
                 * cannot do it for a brand-new account: the session is created before the
                 * profile exists, and sessions live long enough that a second create may be
                 * months away.
                 *
                 * Fire and forget, as on sign-in — a backfill failure must not fail onboarding.
                 */
                void backfillScoresForUser(fastify.db, {
                    userId: session.user.id,
                    profile: { birthChart, birthTime },
                }).catch((error) => {
                    request.log.error({ err: error }, "backfillScoresForUser failed after onboarding");
                });

                reply.status(200).send({
                    data: true,
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

                request.log.error({ err: error }, "Failed to add profile");

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
