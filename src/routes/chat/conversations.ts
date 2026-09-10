import { fromNodeHeaders } from "better-auth/node";
import { FastifyPluginAsync } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { auth } from "../../lib/auth";
import {
    decodeConversationCursor,
    encodeConversationCursor,
    getConversation,
    listConversations,
    listMessages,
    softDeleteConversation,
} from "../../modules/chat/service";
import { CHAT_MESSAGE_STATUSES, CHAT_ROLES } from "../../modules/chat/types";
import { errorSchema } from "../../utils/zodResponse";

/**
 * Reading a thread, and putting one away. No AI, no cost, no rate limit — the same
 * arrangement every other read in this app has.
 *
 * Every query is scoped to the session's own user. A thread that is not theirs answers
 * 404 rather than 403: a 403 would confirm the id exists, which turns an id into
 * something worth guessing.
 */

const PAGE_LIMIT = { conversations: 20, messages: 30 } as const;

const conversationSchema = z.object({
    id: z.string(),
    title: z.string(),
    lastMessageAt: z.string(),
    messageCount: z.number(),
    /** The newest message, truncated. Empty while an answer has yet to produce text. */
    preview: z.string(),
    /** So the list can mark a thread whose answer is still being written. */
    lastMessageStatus: z.enum(CHAT_MESSAGE_STATUSES),
});

const messageSchema = z.object({
    id: z.string(),
    /** Position in the thread, and the pagination cursor. */
    order: z.number(),
    role: z.enum(CHAT_ROLES),
    content: z.string(),
    status: z.enum(CHAT_MESSAGE_STATUSES),
    /** A code the client turns into a sentence. Null unless the answer failed. */
    errorCode: z.string().nullable(),
    createdAt: z.string(),
});

export default (async (fastify) => {
    /* ============================================================
       THE LIST
    ============================================================ */

    fastify.withTypeProvider<ZodTypeProvider>().get(
        "/conversations",
        {
            schema: {
                querystring: z.object({
                    cursor: z.string().optional(),
                    limit: z.coerce.number().int().min(1).max(50).default(PAGE_LIMIT.conversations),
                }),
                response: {
                    200: z.object({
                        data: z.object({
                            items: z.array(conversationSchema),
                            /** Null when this was the last page. */
                            nextCursor: z.string().nullable(),
                        }),
                    }),
                    401: errorSchema,
                    500: errorSchema,
                },
            },
        },
        async (request, reply) => {
            const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });

            if (!session) {
                return reply.status(401).send({
                    error: { code: "unauthorized", message: "User must be logged in to access this resource." },
                });
            }

            try {
                const { limit } = request.query;

                // A cursor that does not decode is a cursor from another version, not an
                // error worth surfacing: start from the top.
                const cursor = request.query.cursor ? decodeConversationCursor(request.query.cursor) : null;

                const items = await listConversations(fastify.db, session.user.id, {
                    cursor: cursor ?? undefined,
                    limit,
                });

                return reply.status(200).send({
                    data: {
                        items: items.map((item) => ({
                            ...item,
                            lastMessageAt: item.lastMessageAt.toISOString(),
                            lastMessageStatus: item.lastMessageStatus as (typeof CHAT_MESSAGE_STATUSES)[number],
                        })),
                        // A full page means there may be more; a short one is the end.
                        nextCursor: items.length === limit ? encodeConversationCursor(items.at(-1)!) : null,
                    },
                });
            } catch (error: unknown) {
                request.log.error({ err: error }, "Failed to list conversations");

                return reply.status(500).send({
                    error: { code: "error", message: "Internal Server Error" },
                });
            }
        }
    );

    /* ============================================================
       ONE THREAD, A PAGE AT A TIME
    ============================================================ */

    fastify.withTypeProvider<ZodTypeProvider>().get(
        "/conversations/:id/messages",
        {
            schema: {
                params: z.object({ id: z.string() }),
                querystring: z.object({
                    /** Everything below this position. Absent means the newest page. */
                    before: z.coerce.number().int().positive().optional(),
                    limit: z.coerce.number().int().min(1).max(100).default(PAGE_LIMIT.messages),
                }),
                response: {
                    200: z.object({
                        data: z.object({
                            conversation: z.object({ id: z.string(), title: z.string() }),
                            /** Oldest first within the page, so it renders in reading order. */
                            items: z.array(messageSchema),
                            /** The lowest position returned, or null at the start of the thread. */
                            nextCursor: z.number().nullable(),
                        }),
                    }),
                    401: errorSchema,
                    404: errorSchema,
                    500: errorSchema,
                },
            },
        },
        async (request, reply) => {
            const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });

            if (!session) {
                return reply.status(401).send({
                    error: { code: "unauthorized", message: "User must be logged in to access this resource." },
                });
            }

            try {
                const conversation = await getConversation(fastify.db, session.user.id, request.params.id);

                if (!conversation) {
                    return reply.status(404).send({
                        error: { code: "conversation_not_found", message: "Conversation not found." },
                    });
                }

                const { limit } = request.query;

                const page = await listMessages(fastify.db, session.user.id, conversation.id, {
                    before: request.query.before,
                    limit,
                });

                return reply.status(200).send({
                    data: {
                        conversation: { id: conversation.id, title: conversation.title },
                        // The query takes the newest first because that is the direction
                        // an index can serve; the screen reads the other way round, and
                        // sorting says so more plainly than reversing does.
                        items: page
                            .map((message) => ({
                                ...message,
                                role: message.role as (typeof CHAT_ROLES)[number],
                                status: message.status as (typeof CHAT_MESSAGE_STATUSES)[number],
                                createdAt: message.createdAt.toISOString(),
                            }))
                            .sort((left, right) => left.order - right.order),
                        nextCursor: page.length === limit ? page.at(-1)!.order : null,
                    },
                });
            } catch (error: unknown) {
                request.log.error({ err: error }, "Failed to read a conversation");

                return reply.status(500).send({
                    error: { code: "error", message: "Internal Server Error" },
                });
            }
        }
    );

    /* ============================================================
       PUTTING ONE AWAY
    ============================================================ */

    fastify.withTypeProvider<ZodTypeProvider>().delete(
        "/conversations/:id",
        {
            schema: {
                params: z.object({ id: z.string() }),
                response: {
                    200: z.object({ data: z.boolean() }),
                    401: errorSchema,
                    404: errorSchema,
                    500: errorSchema,
                },
            },
        },
        async (request, reply) => {
            const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });

            if (!session) {
                return reply.status(401).send({
                    error: { code: "unauthorized", message: "User must be logged in to access this resource." },
                });
            }

            try {
                const deleted = await softDeleteConversation(fastify.db, session.user.id, request.params.id);

                // Not theirs, already gone, or never existed — one answer for all three,
                // so an id cannot be probed for existence.
                if (!deleted) {
                    return reply.status(404).send({
                        error: { code: "conversation_not_found", message: "Conversation not found." },
                    });
                }

                return reply.status(200).send({ data: true });
            } catch (error: unknown) {
                request.log.error({ err: error }, "Failed to delete a conversation");

                return reply.status(500).send({
                    error: { code: "error", message: "Internal Server Error" },
                });
            }
        }
    );
}) satisfies FastifyPluginAsync;
