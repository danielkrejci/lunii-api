import { fromNodeHeaders } from "better-auth/node";
import { and, eq } from "drizzle-orm";
import { Expo } from "expo-server-sdk";
import { FastifyPluginAsync } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { pushTokens } from "../db/schema";
import { auth } from "../lib/auth";
import { PUSH_PLATFORMS } from "../modules/push/types";
import { sendInternalError } from "../utils/errors";
import { errorSchema } from "../utils/zodResponse";

const unauthorized = {
    error: { code: "unauthorized", message: "User must be logged in to access this resource." },
} as const;

export default (async (fastify) => {
    /**
     * Registers this device for the signed-in reader. Sent on every launch with
     * permission, so it is an upsert keyed by the token: the same device again only
     * touches `updated_at`, and a device signed into another account moves to it —
     * a phone notifies whoever is signed in on it, never the previous owner too.
     */
    fastify.withTypeProvider<ZodTypeProvider>().put(
        "/push-tokens",
        {
            schema: {
                body: z.object({
                    token: z.string().refine((token) => Expo.isExpoPushToken(token), "Invalid Expo push token."),
                    platform: z.enum(PUSH_PLATFORMS),
                }),
                response: {
                    200: z.object({ data: z.boolean() }),
                    401: errorSchema,
                    500: errorSchema,
                },
            },
        },
        async (request, reply) => {
            const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });

            if (!session) {
                return reply.status(401).send(unauthorized);
            }

            try {
                const { token, platform } = request.body;

                await fastify.db
                    .insert(pushTokens)
                    .values({ userId: session.user.id, token, platform })
                    .onConflictDoUpdate({
                        target: pushTokens.token,
                        set: { userId: session.user.id, platform, updatedAt: new Date() },
                    });

                return reply.status(200).send({ data: true });
            } catch (error: unknown) {
                return sendInternalError(request, reply, error, "Failed to register push token");
            }
        }
    );

    /**
     * Unregisters this device, on sign-out — before the session is gone, since it needs
     * one. Scoped to the reader: a token that has already moved to another account is
     * that account's now, and is left alone. Answers `true` either way, so a retried
     * sign-out never fails on a row the first attempt removed.
     */
    fastify.withTypeProvider<ZodTypeProvider>().delete(
        "/push-tokens",
        {
            schema: {
                body: z.object({
                    token: z.string().min(1),
                }),
                response: {
                    200: z.object({ data: z.boolean() }),
                    401: errorSchema,
                    500: errorSchema,
                },
            },
        },
        async (request, reply) => {
            const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });

            if (!session) {
                return reply.status(401).send(unauthorized);
            }

            try {
                await fastify.db
                    .delete(pushTokens)
                    .where(and(eq(pushTokens.token, request.body.token), eq(pushTokens.userId, session.user.id)));

                return reply.status(200).send({ data: true });
            } catch (error: unknown) {
                return sendInternalError(request, reply, error, "Failed to delete push token");
            }
        }
    );
}) satisfies FastifyPluginAsync;
