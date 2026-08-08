import { fromNodeHeaders } from "better-auth/node";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone.js";
import utc from "dayjs/plugin/utc.js";
import { FastifyPluginAsync } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { auth } from "../../../lib/auth";
import { calculateDailyCompatibility } from "../../../modules/compatibilityZodiac/scoring";
import { getOrCreateTransits } from "../../../modules/dailyScore/service";
import { SINGS_MAP } from "../../../utils/natalUtils";

dayjs.extend(utc);
dayjs.extend(timezone);

export default (async (fastify) => {
    fastify.withTypeProvider<ZodTypeProvider>().get(
        "/index",
        {
            schema: {
                querystring: z.object({
                    date: z.string().refine((val) => dayjs.utc(val).isValid(), {
                        message: "Invalid date format",
                    }),
                }),
                response: {
                    200: z.object({
                        data: z.array(
                            z.object({
                                sign: z.enum(SINGS_MAP),
                                score: z.number(),
                            })
                        ),
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
                const transits = await getOrCreateTransits(fastify.db, request.query.date, session.profile.timezone);

                const result = SINGS_MAP.map((sign) => {
                    const compatibility = calculateDailyCompatibility(sign, session.profile!.sunSign, transits.planets);
                    console.log({
                        sign,
                        rawScore: compatibility.rawScore,
                        score: compatibility.score,
                        base: compatibility.components.base,
                        venus: compatibility.components.venus,
                        moon: compatibility.components.moon,
                        mars: compatibility.components.mars,
                    });
                    return {
                        sign,
                        rawScore: compatibility.rawScore,
                        score: compatibility.score,
                    };
                })
                    .sort((a, b) => b.rawScore - a.rawScore)
                    .map(({ sign, score }) => ({
                        sign,
                        score,
                    }));

                return reply.status(200).send({
                    data: result,
                });
            } catch (error: unknown) {
                const isDev = process.env.NODE_ENV !== "production";

                request.log.error({ err: error }, "Failed list compatibility with zodiac signs");

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
