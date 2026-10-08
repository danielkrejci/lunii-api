import rateLimit from "@fastify/rate-limit";
import { fromNodeHeaders } from "better-auth/node";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone.js";
import utc from "dayjs/plugin/utc.js";
import { FastifyPluginAsync } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { find as geoTz } from "geo-tz";
import { z } from "zod";

import { auth } from "../../lib/auth";
import { computeNatalChart, NatalChart } from "../../modules/astro";
import { generatePersonalityProfile } from "../../modules/personality/generate";
import { sendInternalError } from "../../utils/errors";
import { Gender, Genders, SINGS_MAP, ZodiacSign } from "../../utils/natalUtils";
import { errorResponseBuilder } from "../../utils/rateLimitResponse";
import { MIN_AGE } from "../profile/add";

dayjs.extend(utc);
dayjs.extend(timezone);

/* ============================================================
   ROUTE
============================================================ */

/**
 * Deliberately free, and deliberately the only generating route that is.
 *
 * This runs during onboarding, before a profile exists and therefore before anyone has
 * a reason to care about credits. A reader who cannot finish signing up is worth far
 * more than five of them. Its model cost stays unbilled on purpose — please do not
 * "fix" that later.
 */
export default (async (fastify) => {
    await fastify.register(rateLimit, {
        max: 5,
        timeWindow: "1 day",
        keyGenerator: async (request) => {
            const session = await auth.api.getSession({
                headers: fromNodeHeaders(request.headers),
            });
            return session?.user?.id ?? request.ip;
        },
        errorResponseBuilder,
    });

    fastify.withTypeProvider<ZodTypeProvider>().post(
        "/generate",
        {
            schema: {
                body: z.object({
                    language: z.string().min(1, "Please select your preferred language."),
                    gender: z
                        .string()
                        .min(1, "Please select your gender.")
                        .refine((value) => Genders.includes(value as Gender), "Invalid gender."),
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
                    /**
                     * Checked against the list rather than merely non-empty, the way
                     * `profile/add` already checks it. The first section of the profile is
                     * now about this string — it is named in the prose and it decides what
                     * the whole section says — so an unrecognised value stops being
                     * cosmetic and becomes a profile about a sign that does not exist.
                     */
                    sunSign: z
                        .string()
                        .min(1, "Please select your Sun sign.")
                        .refine((value) => SINGS_MAP.includes(value as ZodiacSign), "Invalid sign."),
                    relationshipStatus: z.string().min(1, "Please select the option that best suits you."),
                    careerStage: z.string().min(1, "Please select the option that best suits you."),
                    decisionStyle: z.string().min(1, "Please select the option that best suits you."),
                    areasOfInterest: z
                        .array(z.string())
                        .min(1, "Please select 1 to 3 options that best suit you.")
                        .max(3, "You can select up to 3 areas of interest."),
                    contentPreference: z.string().min(1, "Please select your content preference."),
                    beliefLevel: z.string().min(1, "Please select your belief level."),
                }),
                response: {
                    200: z.object({
                        data: z.object({
                            sunSign: z.string(),
                            moonSign: z.string(),
                            risingSign: z.string().nullable(),
                            personalityProfile: z.string(),
                            personalityProfileInput: z.string(),
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

            try {
                const detectedTimezone = geoTz(request.body.birthPlaceLat, request.body.birthPlaceLng)[0] || "UTC";

                /**
                 * The whole chart in one call, rather than the Moon and the Ascendant computed
                 * inline from two raw swisseph calls. Same instant and same house system as
                 * before — this route was the last one still building its own chart — and the
                 * rest of the placements are what lets the profile be about more than three
                 * signs.
                 */
                let chart: NatalChart;

                try {
                    chart = computeNatalChart({
                        birthDate: request.body.birthDate,
                        birthTime: request.body.birthTime,
                        birthPlaceLat: request.body.birthPlaceLat,
                        birthPlaceLng: request.body.birthPlaceLng,
                        timezone: detectedTimezone,
                    }).chart;
                } catch (error: unknown) {
                    request.log.error({ err: error }, "Failed to compute natal chart");

                    return reply.status(409).send({
                        error: {
                            code: "birth_chart_failed",
                            message: "Birth chart could not be computed.",
                        },
                    });
                }

                const moonSign = chart.moon.sign;

                /**
                 * Null without a birth time. The Ascendant moves a full sign roughly every
                 * two hours, so deriving it from an assumed noon returns an essentially
                 * random sign — null is the honest answer, and the scoring engine skips the
                 * Ascendant rather than trusting a fabricated one.
                 */
                const risingSign = chart.ascendant?.sign ?? null;

                const { personalityProfile, personalityProfileInput, empty } = await generatePersonalityProfile(
                    fastify,
                    {
                        userId: session.user.id,
                        chart,
                        hasBirthTime: request.body.birthTime !== null,
                        sunSign: request.body.sunSign,
                        risingSign,
                        relationshipStatus: request.body.relationshipStatus,
                        careerStage: request.body.careerStage,
                        decisionStyle: request.body.decisionStyle,
                        areasOfInterest: request.body.areasOfInterest,
                        contentPreference: request.body.contentPreference,
                        beliefLevel: request.body.beliefLevel,
                        languageIso: request.body.language,
                        gender: request.body.gender as Gender,
                    }
                );

                /**
                 * An empty profile still completes onboarding: the sign-up is worth more
                 * than the text, and the profile can be written again later. It is logged
                 * loudly because everything downstream reads this column — a reader whose
                 * profile is blank gets the generic half of every daily prompt.
                 */
                if (!personalityProfile) {
                    request.log.error({ userId: session.user.id }, "Personality profile came back unusable twice");
                }

                return reply.status(200).send({
                    data: {
                        sunSign: request.body.sunSign,
                        moonSign,
                        risingSign,
                        personalityProfile: personalityProfile ?? empty,
                        personalityProfileInput,
                    },
                });
            } catch (error: unknown) {
                return sendInternalError(request, reply, error, "Failed to generate personality profile");
            }
        }
    );
}) satisfies FastifyPluginAsync;
