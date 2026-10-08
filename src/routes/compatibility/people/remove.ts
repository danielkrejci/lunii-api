import { fromNodeHeaders } from "better-auth/node";
import { and, eq } from "drizzle-orm";
import { FastifyPluginAsync } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { compatibilityPeople, compatibilityPeopleScores } from "../../../db/schema";
import { auth } from "../../../lib/auth";
import { deleteImage, getKeyFromUrl } from "../../../lib/r2";
import { sendInternalError } from "../../../utils/errors";

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
                    .then((rows) => rows[0]);

                if (!compativilityPerson) {
                    return reply.status(404).send({
                        error: {
                            code: "compatibility_person_not_found",
                            message: "Compatibility person not found.",
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

                // remove the compatibility score from the database
                await fastify.db
                    .delete(compatibilityPeopleScores)
                    .where(eq(compatibilityPeopleScores.personId, request.body.compatibilityPersonId));

                // remove the compatibility person from the database
                await fastify.db
                    .delete(compatibilityPeople)
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
                return sendInternalError(request, reply, error, "Failed to remove compatibility person");
            }
        }
    );
}) satisfies FastifyPluginAsync;
