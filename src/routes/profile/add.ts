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
import { personalityContextSchema, personalityOverviewSchema } from "../../modules/personality/schema";
import { deleteStoredImage, importProviderImage } from "../../modules/profile/images";
import { isUniqueViolation, sendInternalError } from "../../utils/errors";
import { getLanguageByIso } from "../../utils/languageUtils";
import { Genders, SINGS_MAP, ZodiacSign } from "../../utils/natalUtils";
import {
    AREAS_OF_INTEREST,
    BELIEF_LEVELS,
    CAREER_STAGES,
    CONTENT_PREFERENCES,
    DECISION_STYLES,
    REFERRERS,
    RELATIONSHIP_STATUSES,
} from "../../utils/profileOptions";

dayjs.extend(utc);
dayjs.extend(timezone);

export const MIN_AGE = 13;

export default (async (fastify) => {
    fastify.withTypeProvider<ZodTypeProvider>().post(
        "/add",
        {
            schema: {
                body: z.object({
                    name: z.string().min(1, "Please enter your name.").max(60, "Name must be 60 characters or fewer."),
                    referrer: z.enum(REFERRERS, { message: "Please select an option." }),
                    gender: z.enum(Genders, { message: "Please select your gender." }),
                    birthDate: z
                        .string()
                        .regex(/^\d{4}-\d{2}-\d{2}$/u, "Birth date must be YYYY-MM-DD.")
                        .refine(
                            (date) => {
                                const today = new Date();
                                const minDate = new Date(
                                    today.getFullYear() - MIN_AGE,
                                    today.getMonth(),
                                    today.getDate()
                                );
                                return new Date(date) <= minDate;
                            },
                            {
                                message: `You must be at least ${MIN_AGE} years old.`,
                            }
                        ),
                    birthTime: z
                        .string()
                        .regex(/^\d{2}:\d{2}$/u, "Birth time must be HH:mm.")
                        .nullable(),
                    birthPlace: z.string().min(1, "Please enter your birth place."),
                    birthPlaceLat: z
                        .number()
                        .min(-90)
                        .max(90)
                        .refine((value) => String(value).length > 0, "Please enter your birth place."),
                    birthPlaceLng: z
                        .number()
                        .min(-180)
                        .max(180)
                        .refine((value) => String(value).length > 0, "Please enter your birth place."),
                    country: z.string().min(1, "Please select your country."),
                    language: z.string().refine((iso) => getLanguageByIso(iso) !== undefined, "Unsupported language."),
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
                    relationshipStatus: z.enum(RELATIONSHIP_STATUSES, {
                        message: "Please select the option that best suits you.",
                    }),
                    careerStage: z.enum(CAREER_STAGES, { message: "Please select the option that best suits you." }),
                    decisionStyle: z.enum(DECISION_STYLES, {
                        message: "Please select the option that best suits you.",
                    }),
                    areasOfInterest: z
                        .array(z.enum(AREAS_OF_INTEREST))
                        .min(1, "Please select 1 to 3 options that best suit you.")
                        .max(3, "You can select up to 3 areas of interest.")
                        .refine((areas) => new Set(areas).size === areas.length, "Each area can be selected once."),
                    contentPreference: z.enum(CONTENT_PREFERENCES, {
                        message: "Please select your content preference.",
                    }),
                    beliefLevel: z.enum(BELIEF_LEVELS, { message: "Please select your belief level." }),
                    /**
                     * As `personality-profile/generate` returned them. Checked against the
                     * shapes rather than taken as strings: the client only relays them, so
                     * anything else here was not written by the generation.
                     */
                    personalityProfile: personalityOverviewSchema,
                    personalityContext: personalityContextSchema.nullable(),
                    personalityProfileInput: z.string().min(1, "Please select your personality profile input."),
                    /**
                     * False when the reader removed the Google photo they were shown, or
                     * picked their own (uploaded right after) — then there is nothing to copy.
                     */
                    useProviderImage: z.boolean().optional(),
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
                        code: "unauthorized",
                        message: "User must be logged in to access this resource.",
                    },
                });
            }

            // Declared out here so a failed insert can take the copied photo back out of R2.
            let image: string | null = null;

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

                /**
                 * A reader who signed up with Google starts with that photo. Only here, at
                 * the one insert a reader ever gets: a photo they later remove stays
                 * removed, and an anonymous reader who links Google afterwards has no
                 * `user.image` to take it from.
                 */
                if (session.user.image && request.body.useProviderImage !== false) {
                    image = await importProviderImage(session.user.id, session.user.image);
                }

                await fastify.db.insert(profile).values({
                    userId: session.user.id,
                    name: request.body.name,
                    image,
                    referrer: request.body.referrer,
                    gender: request.body.gender,
                    birthDate: request.body.birthDate,
                    birthTime: request.body.birthTime,
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
                    contentPreference: request.body.contentPreference,
                    beliefLevel: request.body.beliefLevel,
                    personalityProfile: JSON.stringify(request.body.personalityProfile),
                    personalityContext: request.body.personalityContext,
                    birthChart,
                    personalityProfileInput: request.body.personalityProfileInput,
                });

                reply.status(200).send({
                    data: true,
                });
            } catch (error: unknown) {
                await deleteStoredImage(image).catch((cleanupError: unknown) =>
                    request.log.error({ err: cleanupError }, "Failed to delete imported profile image")
                );

                if (error instanceof EphemerisError) {
                    request.log.error({ err: error }, "Failed to compute birth chart");

                    return reply.status(409).send({
                        error: {
                            code: "birth_chart_failed",
                            message: "Birth chart could not be computed.",
                        },
                    });
                }

                // Two onboarding submits racing past the check above: the unique index on
                // userId lets exactly one through, and the other is the same conflict.
                if (isUniqueViolation(error)) {
                    return reply.status(409).send({
                        error: {
                            code: "profile_already_exists",
                            message: "Profile already exists",
                        },
                    });
                }

                return sendInternalError(request, reply, error, "Failed to add profile");
            }
        }
    );
}) satisfies FastifyPluginAsync;
