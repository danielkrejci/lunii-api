import rateLimit from "@fastify/rate-limit";
import { fromNodeHeaders } from "better-auth/node";
import { and, eq } from "drizzle-orm";
import { FastifyPluginAsync } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { compatibilityPeople } from "../../../../db/schema";
import { auth } from "../../../../lib/auth";
import { deleteImage, getKeyFromUrl, MAX_IMAGE_SIZE, SUPPORTED_IMAGE_TYPES, uploadImage } from "../../../../lib/r2";
import { sendInternalError } from "../../../../utils/errors";
import { errorResponseBuilder } from "../../../../utils/rateLimitResponse";

export default (async (fastify) => {
    /**
     * Registered for this plugin but off by default, so only the route below carries it.
     */
    await fastify.register(rateLimit, {
        global: false,
        keyGenerator: async (request) => {
            const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });

            return session?.user?.id ?? request.ip;
        },
        errorResponseBuilder,
    });

    fastify.withTypeProvider<ZodTypeProvider>().post(
        "/add",
        {
            /**
             * Every upload is a write to R2. Keyed per reader, not per person like the
             * update beside it: the person's id arrives inside the multipart body, which
             * is not parsed yet when the limit is checked. Matches `people/add`.
             */
            config: { rateLimit: { max: 24, timeWindow: "1 day" } },
            schema: {
                response: {
                    200: z.object({
                        data: z.object({
                            imageUrl: z.string(),
                        }),
                    }),
                    400: z.object({
                        error: z.object({
                            code: z.string(),
                            message: z.string(),
                        }),
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

            /**
             * `request.file()` throws on anything that is not multipart, and the catch
             * below would turn the client's mistake into a 500. It is the same mistake
             * as an empty upload, so it gets the same answer.
             */
            if (!request.isMultipart()) {
                return reply.status(400).send({
                    error: {
                        code: "image_not_provided",
                        message: "No image file provided.",
                    },
                });
            }

            try {
                const file = await request.file();

                if (!file) {
                    return reply.status(400).send({
                        error: {
                            code: "image_not_provided",
                            message: "No image file provided.",
                        },
                    });
                }

                // extract compatibilityPersonId from multipart fields
                const compatibilityPersonId = file.fields.compatibilityPersonId;
                if (
                    !compatibilityPersonId ||
                    !("value" in compatibilityPersonId) ||
                    typeof compatibilityPersonId.value !== "string" ||
                    !compatibilityPersonId.value
                ) {
                    return reply.status(400).send({
                        error: {
                            code: "validation_error",
                            message: "compatibilityPersonId: Required.",
                        },
                    });
                }

                // check if the compatibility person exists
                const compativilityPerson = await fastify.db
                    .select({ image: compatibilityPeople.image })
                    .from(compatibilityPeople)
                    .where(
                        and(
                            eq(compatibilityPeople.id, compatibilityPersonId.value),
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

                if (!SUPPORTED_IMAGE_TYPES.includes(file.mimetype as (typeof SUPPORTED_IMAGE_TYPES)[number])) {
                    return reply.status(400).send({
                        error: {
                            code: "unsupported_image_type",
                            message: "Unsupported image type.",
                        },
                    });
                }

                /**
                 * The multipart plugin enforces MAX_IMAGE_SIZE while streaming and throws
                 * once it is crossed, so an oversized upload never reaches the length
                 * check below — that stays only as a backstop.
                 */
                let imageBuffer: Buffer;

                try {
                    imageBuffer = await file.toBuffer();
                } catch (error: unknown) {
                    if (error instanceof fastify.multipartErrors.RequestFileTooLargeError) {
                        return reply.status(400).send({
                            error: {
                                code: "image_too_large",
                                message: `Image too large. Maximum size: ${MAX_IMAGE_SIZE / 1024 / 1024}MB`,
                            },
                        });
                    }

                    throw error;
                }

                if (imageBuffer.length > MAX_IMAGE_SIZE) {
                    return reply.status(400).send({
                        error: {
                            code: "image_too_large",
                            message: `Image too large. Maximum size: ${MAX_IMAGE_SIZE / 1024 / 1024}MB`,
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

                // upload to R2
                const ext = file.mimetype.split("/")[1];
                const key = `compatibility-people/${session.user.id}/${compatibilityPersonId.value}/${crypto.randomUUID()}.${ext}`;
                const imageUrl = await uploadImage(imageBuffer, key, file.mimetype);

                // update the compatibility person in the database
                await fastify.db
                    .update(compatibilityPeople)
                    .set({
                        image: imageUrl,
                    })
                    .where(
                        and(
                            eq(compatibilityPeople.id, compatibilityPersonId.value),
                            eq(compatibilityPeople.userId, session.user.id)
                        )
                    );

                return reply.status(200).send({
                    data: {
                        imageUrl,
                    },
                });
            } catch (error: unknown) {
                return sendInternalError(request, reply, error, "Failed to list compatibility people");
            }
        }
    );
}) satisfies FastifyPluginAsync;
