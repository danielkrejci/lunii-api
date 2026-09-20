import rateLimit from "@fastify/rate-limit";
import { fromNodeHeaders } from "better-auth/node";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import { and, eq } from "drizzle-orm";
import { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { dailyInsights } from "../../db/schema";
import { auth } from "../../lib/auth";
import { buildDayContext } from "../../modules/chat/context";
import { buildHistory, HISTORY_FETCH_LIMIT } from "../../modules/chat/history";
import { buildChatSystemPrompt, buildClosingLanguageRule } from "../../modules/chat/prompt";
import {
    claimRetry,
    getConversation,
    getOpeningMessage,
    getRecentMessages,
    hasActiveStream,
    startTurn,
} from "../../modules/chat/service";
import { openSseChannel } from "../../modules/chat/sse";
import { runChatGeneration } from "../../modules/chat/stream";
import { MAX_MESSAGE_LENGTH } from "../../modules/chat/types";
import { hasActiveSubscription } from "../../modules/credits/service";

dayjs.extend(utc);

/**
 * The send path, and the only endpoint in this app that answers with a stream.
 *
 * Two rules shape every line below.
 *
 * Everything that can fail with a status code is decided BEFORE the response is
 * hijacked — once headers are on the wire the answer is 200 forever, and a 401 sent as
 * an event is a 401 the client's error handling will never see.
 *
 * And no route here declares a `response` schema. The zod serializer would try to
 * validate and send a body Fastify no longer owns.
 */

const dateSchema = z.string().refine((value) => dayjs.utc(value).isValid(), { message: "Invalid date format" });

const sendSchema = z.object({
    /** Null opens a new thread. There is no separate endpoint for that. */
    conversationId: z.string().nullable(),
    content: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
    /** The client's own id for this send, so a retried POST attaches instead of asking twice. */
    clientId: z.string().min(1).max(64),
    date: dateSchema,
});

const retrySchema = z.object({
    conversationId: z.string(),
    messageId: z.string(),
    /**
     * A fresh id for each press of retry, and the key this attempt is charged on.
     *
     * A retry is a paid generation in its own right, so it needs its own idempotency
     * key: reusing the original send's would make every retry free, and having none at
     * all would charge twice for one press when a flaky network repeats the POST.
     */
    clientId: z.string(),
    date: dateSchema,
});

/** The session, or the reply already sent. Every route here starts the same way. */
async function requireReader(request: FastifyRequest, reply: FastifyReply) {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });

    if (!session) {
        await reply.status(401).send({
            error: { code: "unauthorized", message: "User must be logged in to access this resource." },
        });

        return null;
    }

    if (!session.profile) {
        await reply.status(409).send({
            error: { code: "profile_required", message: "User must complete onboarding first." },
        });

        return null;
    }

    return { userId: session.user.id, profile: session.profile };
}

/**
 * Whether this reader may ask anything at all, and whether the day is ready to answer
 * from. Both fail the same way — nothing is written and nothing is charged.
 *
 * Chat is part of the subscription now rather than something bought a question at a
 * time, which is what makes its context safe: a subscriber has `unlocked: true` on
 * everything, so the horoscope in the prompt can never be a text they have not paid for.
 * That single fact removes the whole problem of leaking withheld content into an answer
 * that costs a fraction of it.
 *
 * The readiness half is the other side of the same coin. The prompt carries the
 * horoscope under a heading that tells the model this is what the reader has already
 * read, so answering before it exists would have the model inventing the one thing the
 * reader is most likely to ask about. Waiting is better than guessing.
 */
async function requireChatAccess(
    fastify: FastifyInstance,
    input: { userId: string; date: string },
    reply: FastifyReply
): Promise<boolean> {
    if (!(await hasActiveSubscription(fastify.db, input.userId))) {
        await reply.status(403).send({
            error: {
                code: "subscription_required",
                message: "Chat is part of the subscription.",
                // Answered with the paywall, not an alert.
                silent: true,
            },
        });

        return false;
    }

    const daily = await fastify.db.query.dailyInsights.findFirst({
        columns: { status: true, content: true },
        where: and(eq(dailyInsights.userId, input.userId), eq(dailyInsights.date, input.date)),
    });

    if (!daily?.content) {
        await reply.status(409).send({
            error: {
                code: "context_not_ready",
                message: "Today's horoscope is still being written.",
                silent: true,
                details: { dailyInsight: daily?.status ?? "absent" },
            },
        });

        return false;
    }

    return true;
}

/**
 * Everything the model is told, assembled before a single row is written.
 *
 * Deliberately first: it reads the chart, the day and the scores, and a failure in any
 * of that should be an ordinary 500 with nothing persisted — not a thread holding a
 * question with an answer nobody is writing.
 */
async function buildRequestContext(
    fastify: FastifyInstance,
    input: { userId: string; profile: NonNullable<Awaited<ReturnType<typeof requireReader>>>["profile"]; date: string }
) {
    // The stored profile satisfies `Reader` and `ScoringProfile` structurally, which is
    // the arrangement every generator here uses.
    const systemInstruction = buildChatSystemPrompt({
        reader: input.profile,
        languageIso: input.profile.language,
    });

    const dayContext = await buildDayContext(fastify.db, {
        userId: input.userId,
        profile: input.profile,
        date: input.date,
    });

    // Repeated after the question, where it is the last thing read. See the note on
    // `buildClosingLanguageRule`.
    const closing = buildClosingLanguageRule({
        reader: input.profile,
        languageIso: input.profile.language,
    });

    return { systemInstruction, dayContext, closing };
}

/** The transcript for a thread as it stands right now. */
async function buildTranscript(
    fastify: FastifyInstance,
    input: { userId: string; conversationId: string; dayContext: string; closing: string }
) {
    const [messages, opening] = await Promise.all([
        getRecentMessages(fastify.db, input.userId, input.conversationId, HISTORY_FETCH_LIMIT),
        getOpeningMessage(fastify.db, input.userId, input.conversationId),
    ]);

    return buildHistory({ messages, dayContext: input.dayContext, opening, closing: input.closing });
}

export default (async (fastify) => {
    /**
     * Registered for this plugin but off by default, so it applies only where it is
     * asked for — the two routes below that spend money.
     */
    await fastify.register(rateLimit, {
        global: false,
        keyGenerator: async (request) => {
            const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });

            return session?.user?.id ?? request.ip;
        },
        errorResponseBuilder: (_request, context) => {
            const totalSeconds = Math.floor((context?.ttl ?? 0) / 1000);

            return {
                statusCode: 429,
                error: {
                    hours: Math.floor(totalSeconds / 3600),
                    minutes: Math.floor((totalSeconds % 3600) / 60),
                    message: "You've reached the limit for now. Please try again later.",
                    silent: true,
                },
            };
        },
    });

    /* ============================================================
       SEND — opens a thread if it has to, then streams the answer
    ============================================================ */

    fastify.withTypeProvider<ZodTypeProvider>().post(
        "/messages",
        {
            config: { rateLimit: { max: 40, timeWindow: "1 hour" } },
            schema: {
                body: sendSchema,
                // No `response`: this hijacks the reply, and the serializer must not
                // try to send a body Fastify no longer owns.
            },
        },
        async (request, reply) => {
            const reader = await requireReader(request, reply);

            if (!reader) {
                return;
            }

            const date = dayjs.utc(request.body.date).format("YYYY-MM-DD");

            try {
                /**
                 * One answer at a time. A client stuck in a retry loop would otherwise
                 * fan out paid generations, and the reader can only read one anyway.
                 */
                if (await hasActiveStream(fastify.db, reader.userId)) {
                    return reply.status(409).send({
                        error: { code: "stream_in_progress", message: "An answer is already being written." },
                    });
                }

                /**
                 * Ownership before money. `startTurn` answers "not your conversation" by
                 * returning null, and that is after the debit — so the check moves up
                 * here rather than leaving a compensating refund on the 404 path.
                 */
                if (request.body.conversationId !== null) {
                    const conversation = await getConversation(fastify.db, reader.userId, request.body.conversationId);

                    if (!conversation) {
                        return reply.status(404).send({
                            error: { code: "conversation_not_found", message: "Conversation not found." },
                        });
                    }
                }

                /**
                 * Checked before anything is written, and sent as a plain non-200 body
                 * rather than through the stream: nothing has been written, the reply is
                 * still ours, and the client already turns any pre-stream error body into
                 * a code it can act on.
                 */
                if (!(await requireChatAccess(fastify, { userId: reader.userId, date }, reply))) {
                    return reply;
                }

                const { systemInstruction, dayContext, closing } = await buildRequestContext(fastify, {
                    userId: reader.userId,
                    profile: reader.profile,
                    date,
                });

                const turn = await startTurn(fastify.db, {
                    userId: reader.userId,
                    conversationId: request.body.conversationId,
                    content: request.body.content,
                    clientId: request.body.clientId,
                });

                // Named a conversation that is not theirs, or has been deleted. Never
                // 403 — that would confirm the id exists.
                if (!turn) {
                    return reply.status(404).send({
                        error: { code: "conversation_not_found", message: "Conversation not found." },
                    });
                }

                const channel = openSseChannel(reply);

                channel.send("meta", {
                    conversationId: turn.conversationId,
                    title: turn.title,
                    userMessage: turn.userMessage,
                    assistantMessage: { id: turn.assistantMessage.id, order: turn.assistantMessage.order },
                });

                /**
                 * A retried POST that attached to a send which had in fact succeeded.
                 * The answer already exists, so replay it rather than paying for a
                 * second one.
                 */
                if (turn.resumed && turn.assistantMessage.status === "ready") {
                    channel.send("delta", { text: turn.assistantMessage.content });
                    channel.send("done", {
                        messageId: turn.assistantMessage.id,
                        status: "ready",
                        chars: turn.assistantMessage.content.length,
                    });
                    channel.close();

                    return;
                }

                const { contents } = await buildTranscript(fastify, {
                    userId: reader.userId,
                    conversationId: turn.conversationId,
                    dayContext,
                    closing,
                });

                await runChatGeneration({
                    db: fastify.db,
                    log: request.log,
                    channel,
                    userId: reader.userId,
                    messageId: turn.assistantMessage.id,
                    claimedAt: turn.assistantMessage.claimedAt,
                    systemInstruction,
                    contents,
                });
            } catch (error: unknown) {
                request.log.error({ err: error }, "Failed to start a chat turn");

                // Only reachable while the reply is still ours; everything after
                // `openSseChannel` reports through the stream instead.
                if (!reply.raw.headersSent) {
                    const isDev = process.env.NODE_ENV !== "production";

                    return reply.status(500).send({
                        error: {
                            code: "error",
                            message:
                                isDev && error instanceof Error
                                    ? (error.stack ?? error.message)
                                    : "Internal Server Error",
                        },
                    });
                }
            }
        }
    );

    /* ============================================================
       RETRY — one more attempt at an answer that failed
    ============================================================ */

    fastify.withTypeProvider<ZodTypeProvider>().post(
        "/messages/retry",
        {
            config: { rateLimit: { max: 40, timeWindow: "1 hour" } },
            schema: { body: retrySchema },
        },
        async (request, reply) => {
            const reader = await requireReader(request, reply);

            if (!reader) {
                return;
            }

            const date = dayjs.utc(request.body.date).format("YYYY-MM-DD");

            try {
                if (await hasActiveStream(fastify.db, reader.userId)) {
                    return reply.status(409).send({
                        error: { code: "stream_in_progress", message: "An answer is already being written." },
                    });
                }

                const conversation = await getConversation(fastify.db, reader.userId, request.body.conversationId);

                if (!conversation) {
                    return reply.status(404).send({
                        error: { code: "conversation_not_found", message: "Conversation not found." },
                    });
                }

                if (!(await requireChatAccess(fastify, { userId: reader.userId, date }, reply))) {
                    return reply;
                }

                const { systemInstruction, dayContext, closing } = await buildRequestContext(fastify, {
                    userId: reader.userId,
                    profile: reader.profile,
                    date,
                });

                /**
                 * The claim is what makes this safe to press twice: only a `failed` row
                 * can be taken, and only one taker wins. The position is reused, so the
                 * thread does not grow a gap of dead answers.
                 */
                const claimed = await claimRetry(fastify.db, {
                    userId: reader.userId,
                    conversationId: request.body.conversationId,
                    messageId: request.body.messageId,
                    chargeKey: request.body.clientId,
                });

                if (!claimed) {
                    return reply.status(404).send({
                        error: {
                            code: "message_not_retryable",
                            message: "That answer is not waiting to be retried.",
                        },
                    });
                }

                const channel = openSseChannel(reply);

                channel.send("meta", {
                    conversationId: conversation.id,
                    title: conversation.title,
                    assistantMessage: { id: request.body.messageId },
                });

                const { contents } = await buildTranscript(fastify, {
                    userId: reader.userId,
                    conversationId: conversation.id,
                    dayContext,
                    closing,
                });

                await runChatGeneration({
                    db: fastify.db,
                    log: request.log,
                    channel,
                    userId: reader.userId,
                    messageId: request.body.messageId,
                    claimedAt: claimed.claimedAt,
                    systemInstruction,
                    contents,
                });
            } catch (error: unknown) {
                request.log.error({ err: error }, "Failed to retry a chat answer");

                if (!reply.raw.headersSent) {
                    const isDev = process.env.NODE_ENV !== "production";

                    return reply.status(500).send({
                        error: {
                            code: "error",
                            message:
                                isDev && error instanceof Error
                                    ? (error.stack ?? error.message)
                                    : "Internal Server Error",
                        },
                    });
                }
            }
        }
    );
}) satisfies FastifyPluginAsync;
