import { fromNodeHeaders } from "better-auth/node";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone.js";
import utc from "dayjs/plugin/utc.js";
import { eq } from "drizzle-orm";
import { FastifyPluginAsync } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { transit } from "../../../db/schema";
import { auth } from "../../../lib/auth";
import { calculateDailyCompatibility } from "../../../modules/compatibilityZodiac/scoring";
import { takeUniqueOrThrow } from "../../../utils/drizzleUtils";
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
                const transits = await fastify.db
                    .select()
                    .from(transit)
                    .where(eq(transit.date, request.query.date))
                    .then(takeUniqueOrThrow);

                if (!transits) {
                    return reply.status(400).send({
                        error: {
                            message: "No transits found for this date",
                        },
                    });
                }

                console.log("======= transits =======");
                console.log(JSON.stringify(transits, null, 4));

                const result = SINGS_MAP.map((sign) => {
                    const compatibility = calculateDailyCompatibility(sign, session.profile.sunSign, transits.planets);
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

                // const compute = [calculateDailyCompatibility("taurus", session.profile.sunSign, transits.planets)];

                return reply.status(200).send({
                    data: result,
                });
            } catch (e: any) {
                return reply.status(400).send({
                    error: {
                        message: "detail" in e ? e.detail : "message" in e ? e.message : "Error",
                    },
                });
            }
        }
    );
}) satisfies FastifyPluginAsync;
