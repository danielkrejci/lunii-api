import { toNodeHandler } from "better-auth/node";
import { FastifyInstance, FastifyPluginAsync } from "fastify";

import { auth } from "../lib/auth";

export default (async (fastify: FastifyInstance) => {
    const authHandler = toNodeHandler(auth.handler);

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
                        reply.raw.end(
                            JSON.stringify({ error: { code: "internal_error", message: "Internal Server Error" } })
                        );
                    }
                }
            },
        });
    });
}) satisfies FastifyPluginAsync;
