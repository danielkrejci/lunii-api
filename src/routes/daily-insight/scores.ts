import { fromNodeHeaders } from "better-auth/node";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import { FastifyPluginAsync } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { auth } from "../../lib/auth";
import { getDailyScore } from "../../modules/dailyScore/service";

dayjs.extend(utc);

const errorSchema = z.object({
    error: z.object({
        code: z.string(),
        message: z.string(),
    }),
});

export default (async (fastify) => {
    fastify.withTypeProvider<ZodTypeProvider>().get(
        "/scores",
        {
            schema: {
                querystring: z.object({
                    date: z.string().refine((val) => dayjs.utc(val).isValid(), {
                        message: "Invalid date format",
                    }),
                }),
                response: {
                    200: z.object({
                        data: z.object({
                            date: z.string(),
                            loveScore: z.number(),
                            careerScore: z.number(),
                            healthScore: z.number(),
                            moodScore: z.number(),
                            overallScore: z.number(),
                            confidence: z.number().nullable(),
                        }),
                    }),
                    401: errorSchema,
                    409: errorSchema,
                    500: errorSchema,
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

                // Reads the stored row, or computes and stores it. No AI on this path.
                const score = await getDailyScore(fastify.db, {
                    userId: session.user.id,
                    profile: session.profile,
                    date,
                });

                return reply.status(200).send({ data: score });
            } catch (error: unknown) {
                const isDev = process.env.NODE_ENV !== "production";

                request.log.error({ err: error }, "Failed to generate daily score");

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
