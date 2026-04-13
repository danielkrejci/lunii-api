import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import { eq } from "drizzle-orm";
import { FastifyInstance, FastifyPluginAsync } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import z from "zod";
import { user } from "../db/schema";
import { auth } from "../lib/auth";

export default (async (fastify: FastifyInstance) => {
    const authHandler = toNodeHandler(auth.handler);

    // Custom route with default body parsing enabled
    await fastify.withTypeProvider<ZodTypeProvider>().post(
        "/auth/notification-token",
        {
            schema: {
                body: z.object({
                    token: z.string(),
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
                await fastify.db
                    .update(user)
                    .set({ notificationToken: request.body.token })
                    .where(eq(user.id, session.user.id));

                reply.status(200).send({
                    data: true,
                });
            } catch (error: unknown) {
                const errorMessage =
                    error instanceof Error
                        ? error.message
                        : typeof error === "object" && error !== null && "detail" in error
                          ? String(error.detail)
                          : "Error";
                reply.status(400).send({
                    error: {
                        message: errorMessage,
                    },
                });
            }
        }
    );

    // sub-context for better-auth routes that need raw stream
    await fastify.register(async (childCtx) => {
        // disable body parsing for this context so better-auth can handle the stream
        childCtx.addContentTypeParser("application/json", (_request, _payload, done) => {
            done(null, null);
        });

        await childCtx.route({
            method: ["POST", "GET"],
            url: "/auth/*",
            handler: async (req, reply) => {
                return await authHandler(req.raw, reply.raw);
            },
        });
    });
}) satisfies FastifyPluginAsync;
