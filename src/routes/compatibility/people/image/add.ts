import { fromNodeHeaders } from "better-auth/node";
import { and, eq } from "drizzle-orm";
import { FastifyPluginAsync } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { compatibilityPeople } from "../../../../db/schema";
import { auth } from "../../../../lib/auth";
import { deleteImage, getKeyFromUrl, MAX_IMAGE_SIZE, SUPPORTED_IMAGE_TYPES, uploadImage } from "../../../../lib/r2";
import { takeUniqueOrThrow } from "../../../../utils/drizzleUtils";

export default (async (fastify) => {
    fastify.withTypeProvider<ZodTypeProvider>().post(
        "/add",
        {
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

            try {
                const file = await request.file();

                if (!file) {
                    return reply.status(409).send({
                        error: {
                            code: "image_not_provided",
                            message: "No image file provided",
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
                            code: "compatibility_person_not_found",
                            message: "Compatibility person not found",
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
                    .then(takeUniqueOrThrow);

                if (!compativilityPerson) {
                    return reply.status(409).send({
                        error: {
                            code: "compatibility_person_not_found",
                            message: "Compatibility person not found",
                        },
                    });
                }

                if (!SUPPORTED_IMAGE_TYPES.includes(file.mimetype as (typeof SUPPORTED_IMAGE_TYPES)[number])) {
                    return reply.status(400).send({
                        error: {
                            code: "unsupported_image_type",
                            message: `Unsupported image type: ${file.mimetype}. Supported: ${SUPPORTED_IMAGE_TYPES.join(", ")}`,
                        },
                    });
                }

                const imageBuffer = await file.toBuffer();

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
                const isDev = process.env.NODE_ENV !== "production";

                request.log.error({ err: error }, "Failed to list compatibility people");

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
