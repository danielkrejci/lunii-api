import { fromNodeHeaders } from "better-auth/node";
import { eq } from "drizzle-orm";
import { FastifyPluginAsync } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { profile } from "../../../db/schema";
import { auth } from "../../../lib/auth";
import { deleteStoredImage } from "../../../modules/profile/images";
import { sendInternalError } from "../../../utils/errors";

export default (async (fastify) => {
    fastify.withTypeProvider<ZodTypeProvider>().post(
        "/remove",
        {
            schema: {
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
                const profileData = await fastify.db
                    .select({ image: profile.image })
                    .from(profile)
                    .where(eq(profile.userId, session.user.id))
                    .then((rows) => rows[0]);

                if (!profileData) {
                    return reply.status(404).send({
                        error: {
                            code: "profile_not_found",
                            message: "Profile not found.",
                        },
                    });
                }

                await deleteStoredImage(profileData.image);

                await fastify.db.update(profile).set({ image: null }).where(eq(profile.userId, session.user.id));

                return reply.status(200).send({
                    data: true,
                });
            } catch (error: unknown) {
                return sendInternalError(request, reply, error, "Failed to remove profile image");
            }
        }
    );
}) satisfies FastifyPluginAsync;
