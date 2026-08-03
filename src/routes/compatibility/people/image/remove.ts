import { fromNodeHeaders } from "better-auth/node";
import { and, eq } from "drizzle-orm";
import { FastifyPluginAsync } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { compatibilityPeople } from "../../../../db/schema";
import { auth } from "../../../../lib/auth";
import { deleteImage, getKeyFromUrl } from "../../../../lib/r2";
import { takeUniqueOrThrow } from "../../../../utils/drizzleUtils";

export default (async (fastify) => {
    fastify.withTypeProvider<ZodTypeProvider>().post(
        "/remove",
        {
            schema: {
                body: z.object({
                    compatibilityPersonId: z.string().min(1),
                }),
                response: {
                    200: z.object({
                        data: z.boolean(),
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
                    500: z.object({
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
                // check if the compatibility person exists
                const compativilityPerson = await fastify.db
                    .select({ image: compatibilityPeople.image })
                    .from(compatibilityPeople)
                    .where(
                        and(
                            eq(compatibilityPeople.id, request.body.compatibilityPersonId),
                            eq(compatibilityPeople.userId, session.user.id)
                        )
                    )
                    .then(takeUniqueOrThrow);

                if (!compativilityPerson) {
                    return reply.status(404).send({
                        error: {
                            message: "Compatibility person not found",
                        },
                    });
                }

                // remove the image from R2 storage if one exists
                if (compativilityPerson.image) {
                    const key = getKeyFromUrl(compativilityPerson.image);

                    if (key) {
                        await deleteImage(key);
                    }
                }

                // update the compatibility person in the database
                await fastify.db
                    .update(compatibilityPeople)
                    .set({
                        image: null,
                    })
                    .where(
                        and(
                            eq(compatibilityPeople.id, request.body.compatibilityPersonId),
                            eq(compatibilityPeople.userId, session.user.id)
                        )
                    );

                reply.status(200).send({
                    data: true,
                });
            } catch (error: unknown) {
                const isDev = process.env.NODE_ENV !== "production";

                request.log.error({ err: error }, "Failed to list compatibility people");

                return reply.status(500).send({
                    error: {
                        message:
                            isDev && error instanceof Error ? (error.stack ?? error.message) : "Internal Server Error",
                    },
                });
            }
        }
    );
}) satisfies FastifyPluginAsync;
