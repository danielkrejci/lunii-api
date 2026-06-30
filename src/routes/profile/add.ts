import { fromNodeHeaders } from "better-auth/node";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone.js";
import utc from "dayjs/plugin/utc.js";
import { FastifyPluginAsync } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { find as geoTz } from "geo-tz";
import { z } from "zod";

import { profile } from "../../db/schema";
import { auth } from "../../lib/auth";

dayjs.extend(utc);
dayjs.extend(timezone);

export const MIN_AGE = 15;

export default (async (fastify) => {
    fastify.withTypeProvider<ZodTypeProvider>().post(
        "/add",
        {
            schema: {
                body: z.object({
                    name: z.string().min(1, "Name is required").max(60, "Name must be at most 60 characters long"),
                    referrer: z.string().min(1, "Select where did you hear about us"),
                    gender: z.string().min(1, "Gender is required"),
                    birthDate: z.string().refine(
                        (date) => {
                            const today = new Date();
                            const minDate = new Date(today.getFullYear() - MIN_AGE, today.getMonth(), today.getDate());
                            return new Date(date) <= minDate;
                        },
                        {
                            message: `You must be at least ${MIN_AGE} years old`,
                        }
                    ),
                    birthTime: z.string().nullable(),
                    birthPlace: z.string().min(1, "Birth place is required"),
                    birthPlaceLat: z.number().refine((value) => String(value).length > 0, "Birth place is required"),
                    birthPlaceLng: z.number().refine((value) => String(value).length > 0, "Birth place is required"),
                    country: z.string().min(1, "Country is required"),
                    language: z.string().min(1, "Language is required"),
                    sunSign: z.string().min(1, "Sun sign is required"),
                    moonSign: z.string().min(1, "Moon sign is required"),
                    risingSign: z.string().min(1, "Rising sign is required"),
                    relationshipStatus: z.string().min(1, "Relationship status is required"),
                    careerStage: z.string().min(1, "Career stage is required"),
                    decisionStyle: z.string().min(1, "Decision style is required"),
                    areasOfInterest: z
                        .array(z.string())
                        .min(1, "Areas of interest are required")
                        .max(3, "Maximum 3 areas of interest"),
                    goalsForTheYear: z
                        .array(z.string())
                        .min(1, "Goals for the year are required")
                        .max(3, "Maximum 3 goals for the year"),
                    contentPreference: z.string().min(1, "Content preference is required"),
                    beliefLevel: z.string().min(1, "Belief level is required"),
                    personalityProfile: z.string().min(1, "Personality profile is required"),
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
