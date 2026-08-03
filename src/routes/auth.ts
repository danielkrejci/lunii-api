import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import { eq } from "drizzle-orm";
import { FastifyInstance, FastifyPluginAsync } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import z from "zod";

import { profile } from "../db/schema";
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
                    .update(profile)
                    .set({ notificationToken: request.body.token })
                    .where(eq(profile.userId, session.user.id));

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
        // better-auth reads the request body straight off req.raw, so no Fastify
        // parser may consume the stream first. Overriding only application/json is
        // not enough: Sign in with Apple uses response_mode=form_post and POSTs
        // application/x-www-form-urlencoded to /auth/callback/apple, where the
        // app-wide @fastify/formbody parser drains the stream. better-auth then
        // sees an empty body, redirects to the GET callback without `state`, and
        // fails with `state_not_found`. Drop every inherited parser in this scope
        // and register a no-op catch-all that leaves req.raw untouched.
        childCtx.removeAllContentTypeParsers();
        childCtx.addContentTypeParser("*", (_request, _payload, done) => {
            done(null, null);
        });

        await childCtx.route({
            method: ["POST", "GET"],
            url: "/auth/*",
            handler: async (req, reply) => {
                // better-auth writes to the raw socket itself; take the reply away
                // from Fastify so it never tries to send a second response.
                reply.hijack();

                try {
                    await authHandler(req.raw, reply.raw);
                } catch (error) {
                    fastify.log.error({ err: error }, "better-auth handler failed");
                    if (!reply.raw.headersSent) {
                        reply.raw.writeHead(500, { "content-type": "application/json" });
                    }
                    if (!reply.raw.writableEnded) {
                        reply.raw.end(JSON.stringify({ error: { message: "Internal Server Error" } }));
                    }
                }
            },
        });
    });
}) satisfies FastifyPluginAsync;
