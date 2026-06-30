import { fromNodeHeaders } from "better-auth/node";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import { eq } from "drizzle-orm";
import { FastifyPluginAsync } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { transit } from "../db/schema";
import { auth } from "../lib/auth";

dayjs.extend(utc);

export default (async (fastify) => {
    fastify.withTypeProvider<ZodTypeProvider>().get(
        "/transits",
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
                            planets: z.any(),
                            aspects: z.any(),
                        }),
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

            if (!session) {
                return reply.status(401).send({
                    error: {
                        message: "Unauthorized",
                    },
                });
            }

            try {
                const data = await fastify.db.select().from(transit).where(eq(transit.date, request.query.date));

                if (!data) {
                    return reply.status(404).send({
                        error: {
                            message: "No transits found for this date",
                        },
                    });
                }

                return reply.status(200).send({
                    data: {
                        date: data[0].date,
                        planets: data[0].planets,
                        aspects: data[0].aspects,
                    },
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
