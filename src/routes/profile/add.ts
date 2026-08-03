import { fromNodeHeaders } from "better-auth/node";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone.js";
import utc from "dayjs/plugin/utc.js";
import { FastifyPluginAsync } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { find as geoTz } from "geo-tz";
import swisseph from "swisseph";
import { z } from "zod";

import { profile } from "../../db/schema";
import { auth } from "../../lib/auth";
import { NatalChart } from "../../modules/compatibilityPeople/types";
import { getPlanetPosition } from "../../modules/transits";
import { Gender, Genders } from "../../utils/natalUtils";

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
                    sunSign: z.string().min(1, "Please select your Sun sign."),
                    moonSign: z.string().min(1, "Please select your Moon sign."),
                    risingSign: z.string().min(1, "Please select your Rising sign."),
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
                }),
                response: {
                    200: z.object({
                        data: z.boolean(),
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
                        message: "Unauthorized",
                    },
                });
            }

            try {
                const detectedTimezone = geoTz(request.body.birthPlaceLat, request.body.birthPlaceLng)[0] || "UTC";

                const birthDate = dayjs(request.body.birthDate);
                const birthTime = request.body.birthTime ? dayjs(request.body.birthTime) : dayjs().hour(12).minute(0);

                const absoluteBirthDate = dayjs
                    .tz(birthDate.format("YYYY-MM-DD"), detectedTimezone)
                    .hour(birthTime.hour())
                    .minute(birthTime.minute())
                    .second(0)
                    .millisecond(0)
                    .toDate();

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

                await fastify.db.insert(profile).values({
                    userId: session.user.id,
                    name: request.body.name,
                    referrer: request.body.referrer,
                    gender: request.body.gender,
                    birthDate: request.body.birthDate,
                    birthTime: request.body.birthTime ? dayjs(request.body.birthTime).format("HH:mm") : null,
                    birthPlace: request.body.birthPlace,
                    birthPlaceLat: request.body.birthPlaceLat,
                    birthPlaceLng: request.body.birthPlaceLng,
                    country: request.body.country,
                    language: request.body.language,
                    timezone: detectedTimezone,
                    sunSign: request.body.sunSign,
                    moonSign: request.body.moonSign,
                    risingSign: request.body.risingSign,
                    relationshipStatus: request.body.relationshipStatus,
                    careerStage: request.body.careerStage,
                    decisionStyle: request.body.decisionStyle,
                    areasOfInterest: request.body.areasOfInterest,
                    goalsForTheYear: request.body.goalsForTheYear,
                    contentPreference: request.body.contentPreference,
                    beliefLevel: request.body.beliefLevel,
                    personalityProfile: request.body.personalityProfile,
                    birthChart,
                });

                reply.status(200).send({
                    data: true,
                });
            } catch (e: any) {
                reply.status(400).send({
                    error: {
                        message: "detail" in e ? e.detail : "message" in e ? e.message : "Error",
                    },
                });
            }
        }
    );
}) satisfies FastifyPluginAsync;
