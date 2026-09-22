import { and, asc, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { FastifyInstance } from "fastify";

import { chatConversations, chatMessages } from "../../db/schema";
import { ChatErrorCode, MAX_TITLE_LENGTH, STREAM_TIMEOUT_MINUTES } from "./types";

type Db = FastifyInstance["db"];

/**
 * Every read and every write of a conversation, in one place.
 *
 * The reader is a required argument on all of them rather than something a caller may
 * remember to filter by. That is the whole security model of this feature: ownership
 * is a WHERE clause that is impossible to omit, not a check a route performs after
 * fetching. A handler cannot build an unscoped query without deliberately writing one.
 *
 * Nothing here holds a connection for longer than a single statement — except the one
 * transaction in `startTurn`, which is three short writes. The pool is capped at five,
 * and a chat turn spends twenty seconds inside the model; a transaction open across
 * that would exhaust the pool at five concurrent readers.
 */

/**
 * Every timestamp this module writes, truncated to milliseconds.
 *
 * `now()` carries microseconds and a JS `Date` does not, so any value that leaves the
 * database and comes back has already lost precision. Two things here depend on it
 * coming back unchanged, and both break silently otherwise:
 *
 * - the claim on a streaming row, which the next write matches on — full precision
 *   would match no row at all;
 * - the keyset cursor over `last_message_at`, which the next page compares against —
 *   full precision leaves the row the cursor came from just above the cursor, so the
 *   page repeats it. Measured: `now()` gave `.875139`, the cursor came back `.875`.
 */
const nowToMillisecond = sql`date_trunc('milliseconds', now())`;

/** A run that has not touched its row within the timeout is presumed dead. */
const streamDeadline = sql`now() - make_interval(mins => ${STREAM_TIMEOUT_MINUTES})`;

/**
 * The thread's name, from the message that opened it.
 *
 * Cut on a word boundary, because a title sliced mid-word reads as a bug rather than
 * as an abbreviation. Falls back to a hard cut for text with no spaces in it at all —
 * a pasted URL, or a language that does not space its words.
 */
export function buildConversationTitle(content: string): string {
    const normalized = content.trim().replaceAll(/\s+/gu, " ");

    if (normalized.length <= MAX_TITLE_LENGTH) {
        return normalized;
    }

    const cut = normalized.slice(0, MAX_TITLE_LENGTH);
    const lastSpace = cut.lastIndexOf(" ");

    // Only honour the boundary if it leaves a usable title behind; a first "word" of
    // 55 characters would otherwise truncate to almost nothing.
    return (lastSpace > MAX_TITLE_LENGTH / 2 ? cut.slice(0, lastSpace) : cut).trimEnd();
}

export interface StartedTurn {
    conversationId: string;
    title: string;
    userMessage: { id: string; order: number; createdAt: Date };
    assistantMessage: {
        id: string;
        order: number;
        /**
         * The claim on the row. Every subsequent write carries it, so a run whose row
         * has been taken over meanwhile writes nothing instead of overwriting what
         * replaced it.
         */
        claimedAt: Date;
        /** Already `ready` when this attached to a send that had in fact succeeded. */
        status: string;
        content: string;
    };
    /**
     * True when this POST carried a `clientId` already on file and attached to the
     * messages it wrote the first time. The caller must not start a second generation
     * for a turn whose assistant message is already `ready`.
     */
    resumed: boolean;
}

/**
 * Opens a turn: the reader's message and the empty assistant message it will be
 * answered in, written together so a thread can never hold a question with nothing
 * claiming to answer it.
 *
 * Creates the conversation when `conversationId` is null — there is no separate
 * endpoint for that, because a thread with no messages is a state worth making
 * impossible rather than filtering out of the list later.
 *
 * Returns null when a conversation was named and it is not this reader's live thread.
 * The caller answers 404 for that, never 403: a 403 would confirm the id exists.
 */
export async function startTurn(
    db: Db,
    input: { userId: string; conversationId: string | null; content: string; clientId: string }
): Promise<StartedTurn | null> {
    const { userId, clientId } = input;
    const content = input.content.trim();

    return db.transaction(async (tx) => {
        /**
         * Idempotency, before anything is written. A retried POST — a dropped socket, a
         * backgrounded app — carries the same `clientId` and must attach to the turn it
         * already created rather than asking, and paying, a second time.
         */
        const [seen] = await tx
            .select({
                id: chatMessages.id,
                conversationId: chatMessages.conversationId,
                order: chatMessages.order,
                createdAt: chatMessages.createdAt,
            })
            .from(chatMessages)
            .where(and(eq(chatMessages.userId, userId), eq(chatMessages.clientId, clientId)))
            .limit(1);

        if (seen) {
            const [answer] = await tx
                .select({
                    id: chatMessages.id,
                    order: chatMessages.order,
                    claimedAt: chatMessages.updatedAt,
                    status: chatMessages.status,
                    content: chatMessages.content,
                })
                .from(chatMessages)
                .where(
                    and(eq(chatMessages.conversationId, seen.conversationId), eq(chatMessages.order, seen.order + 1))
                )
                .limit(1);

            // Both halves are written in one transaction, so a question with no answer
            // row is not a state this table can reach.
            if (!answer) {
                throw new Error(`Chat message ${seen.id} has no assistant row at order ${seen.order + 1}`);
            }

            const [conversation] = await tx
                .select({ title: chatConversations.title })
                .from(chatConversations)
                .where(eq(chatConversations.id, seen.conversationId))
                .limit(1);

            return {
                conversationId: seen.conversationId,
                title: conversation?.title ?? "",
                userMessage: { id: seen.id, order: seen.order, createdAt: seen.createdAt },
                assistantMessage: answer,
                resumed: true,
            };
        }

        let conversationId: string;
        let title: string;
        let userOrder: number;

        if (input.conversationId === null) {
            const [created] = await tx
                .insert(chatConversations)
                .values({
                    userId,
                    title: buildConversationTitle(content),
                    // Two positions are spent below, so the counter starts past them.
                    nextOrder: 3,
                    // Not the column default: that is `now()`, and the list's cursor
                    // needs a value that survives a round trip through a JS `Date`.
                    lastMessageAt: nowToMillisecond,
                })
                .returning({ id: chatConversations.id, title: chatConversations.title });

            conversationId = created.id;
            title = created.title;
            userOrder = 1;
        } else {
            /**
             * Claiming the positions and confirming ownership in one statement. The
             * UPDATE locks the row for the rest of the transaction, which is what makes
             * two simultaneous sends impossible to give the same position — a SELECT of
             * `max(message_order)` would let both read the same number.
             */
            const [claimed] = await tx
                .update(chatConversations)
                .set({ nextOrder: sql`${chatConversations.nextOrder} + 2`, lastMessageAt: nowToMillisecond })
                .where(
                    and(
                        eq(chatConversations.id, input.conversationId),
                        eq(chatConversations.userId, userId),
                        isNull(chatConversations.deletedAt)
                    )
                )
                .returning({
                    id: chatConversations.id,
                    title: chatConversations.title,
                    nextOrder: chatConversations.nextOrder,
                });

            if (!claimed) {
                return null;
            }

            conversationId = claimed.id;
            title = claimed.title;
            userOrder = claimed.nextOrder - 2;
        }

        const [userMessage] = await tx
            .insert(chatMessages)
            .values({
                conversationId,
                userId,
                order: userOrder,
                role: "user",
                content,
                status: "ready",
                clientId,
            })
            .returning({
                id: chatMessages.id,
                order: chatMessages.order,
                createdAt: chatMessages.createdAt,
            });

        const [assistantMessage] = await tx
            .insert(chatMessages)
            .values({
                conversationId,
                userId,
                order: userOrder + 1,
                role: "assistant",
                content: "",
                status: "streaming",
                // The claim, set explicitly so it is millisecond-precise from the start.
                updatedAt: nowToMillisecond,
            })
            .returning({
                id: chatMessages.id,
                order: chatMessages.order,
                claimedAt: chatMessages.updatedAt,
                status: chatMessages.status,
                content: chatMessages.content,
            });

        return {
            conversationId,
            title,
            userMessage,
            assistantMessage,
            resumed: false,
        };
    });
}

/**
 * Whether this reader already has an answer being written.
 *
 * One indexed lookup, and the reason a stuck client cannot fan out paid generations.
 * Rows past the timeout do not count: the run that owned them is gone, and the sweeper
 * has simply not reached them yet.
 */
export async function hasActiveStream(db: Db, userId: string): Promise<boolean> {
    const [active] = await db
        .select({ id: chatMessages.id })
        .from(chatMessages)
        .where(
            and(
                eq(chatMessages.userId, userId),
                eq(chatMessages.status, "streaming"),
                gt(chatMessages.updatedAt, streamDeadline)
            )
        )
        .limit(1);

    return active !== undefined;
}

/**
 * The rolling write during a stream: the text so far, and a fresh claim.
 *
 * The claim moves with every write on purpose — it is also the heartbeat that tells
 * the sweeper this run is alive. Callers must carry the returned timestamp forward;
 * writing with a stale one matches nothing, which is exactly the intent when a retry
 * has taken the row over.
 *
 * Returns null when the row has moved on, so the caller can stop writing.
 */
export async function writePartialContent(
    db: Db,
    input: { messageId: string; claimedAt: Date; content: string }
): Promise<Date | null> {
    const [written] = await db
        .update(chatMessages)
        .set({ content: input.content, updatedAt: nowToMillisecond })
        .where(
            and(
                eq(chatMessages.id, input.messageId),
                eq(chatMessages.updatedAt, input.claimedAt),
                eq(chatMessages.status, "streaming")
            )
        )
        .returning({ claimedAt: chatMessages.updatedAt });

    return written?.claimedAt ?? null;
}

/** The finished answer. Returns false when the row had moved on and nothing was kept. */
export async function completeMessage(
    db: Db,
    input: { messageId: string; claimedAt: Date; content: string }
): Promise<boolean> {
    const written = await db
        .update(chatMessages)
        .set({ content: input.content, status: "ready", errorCode: null, updatedAt: nowToMillisecond })
        .where(and(eq(chatMessages.id, input.messageId), eq(chatMessages.updatedAt, input.claimedAt)))
        .returning({ id: chatMessages.id });

    return written.length > 0;
}

/**
 * The answer that did not arrive.
 *
 * Whatever text made it through is kept rather than cleared: a half-written answer
 * with a retry underneath it is worth more on screen than an empty bubble, and the
 * `ready` check constraint does not apply to a failed row.
 */
export async function failMessage(
    db: Db,
    input: { messageId: string; claimedAt: Date; errorCode: ChatErrorCode; content: string }
): Promise<boolean> {
    const [written] = await db
        .update(chatMessages)
        .set({
            content: input.content,
            status: "failed",
            errorCode: input.errorCode,
            updatedAt: nowToMillisecond,
        })
        .where(and(eq(chatMessages.id, input.messageId), eq(chatMessages.updatedAt, input.claimedAt)))
        /**
         * Only the run that actually owned this row gets a row back, which is what tells
         * a dying run from the sweeper arriving after it.
         */
        .returning({ id: chatMessages.id });

    return written !== undefined;
}

/**
 * Takes a failed answer back for a second attempt, in one statement.
 *
 * A SELECT followed by an UPDATE would let two taps on "Try again" both start a paid
 * generation. Only a `failed` row can be claimed, so a retry can never interrupt an
 * answer that is still being written or overwrite one that arrived.
 *
 * The position is reused rather than appended, so a thread does not accumulate a gap
 * of dead assistant rows.
 */
export async function claimRetry(
    db: Db,
    input: { userId: string; conversationId: string; messageId: string }
): Promise<{ claimedAt: Date } | null> {
    const [claimed] = await db
        .update(chatMessages)
        .set({
            status: "streaming",
            content: "",
            errorCode: null,
            updatedAt: nowToMillisecond,
        })
        .where(
            and(
                eq(chatMessages.id, input.messageId),
                eq(chatMessages.userId, input.userId),
                eq(chatMessages.conversationId, input.conversationId),
                eq(chatMessages.role, "assistant"),
                eq(chatMessages.status, "failed")
            )
        )
        .returning({ claimedAt: chatMessages.updatedAt });

    return claimed ?? null;
}

/** One live thread of this reader's, or null. The ownership check, on its own. */
export async function getConversation(db: Db, userId: string, conversationId: string) {
    const [conversation] = await db
        .select({
            id: chatConversations.id,
            title: chatConversations.title,
            lastMessageAt: chatConversations.lastMessageAt,
            createdAt: chatConversations.createdAt,
        })
        .from(chatConversations)
        .where(
            and(
                eq(chatConversations.id, conversationId),
                eq(chatConversations.userId, userId),
                isNull(chatConversations.deletedAt)
            )
        )
        .limit(1);

    return conversation ?? null;
}

/** An opaque cursor over `(last_message_at, id)`, so a page cannot skip or repeat. */
export function encodeConversationCursor(row: { lastMessageAt: Date; id: string }): string {
    return Buffer.from(`${row.lastMessageAt.toISOString()}|${row.id}`).toString("base64url");
}

export function decodeConversationCursor(cursor: string): { lastMessageAt: Date; id: string } | null {
    const [at, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    const lastMessageAt = new Date(at ?? "");

    if (!id || Number.isNaN(lastMessageAt.getTime())) {
        return null;
    }

    return { lastMessageAt, id };
}

export interface ConversationSummary {
    id: string;
    title: string;
    lastMessageAt: Date;
    messageCount: number;
    /** The newest message, truncated. Empty while an answer has produced nothing yet. */
    preview: string;
    /** The newest message's status, so the list can show a thread still being written. */
    lastMessageStatus: string;
}

/**
 * One page of this reader's live threads, newest first.
 *
 * Keyset on `(last_message_at, id)` rather than an offset: threads move to the top as
 * they are used, and an offset would skip or repeat one every time that happened. The
 * id is the tiebreaker, because two threads can be touched in the same millisecond.
 */
export async function listConversations(
    db: Db,
    userId: string,
    options: { cursor?: { lastMessageAt: Date; id: string }; limit: number }
): Promise<ConversationSummary[]> {
    const page = await db
        .select({
            id: chatConversations.id,
            title: chatConversations.title,
            lastMessageAt: chatConversations.lastMessageAt,
        })
        .from(chatConversations)
        .where(
            and(
                eq(chatConversations.userId, userId),
                isNull(chatConversations.deletedAt),
                /**
                 * Spelled out with typed comparisons rather than as a row-value
                 * `(a, b) < (c, d)`. Inside a raw `sql` template Drizzle passes a JS
                 * `Date` straight to the driver, which serialises it in the Node
                 * process's local time with an offset; the column is `timestamp`
                 * without a zone, so Postgres drops the offset and the value lands
                 * hours away from what was stored. Through `lt` and `eq` the column's
                 * own mapper runs and the comparison is the one that was meant.
                 */
                options.cursor
                    ? or(
                          lt(chatConversations.lastMessageAt, options.cursor.lastMessageAt),
                          and(
                              eq(chatConversations.lastMessageAt, options.cursor.lastMessageAt),
                              lt(chatConversations.id, options.cursor.id)
                          )
                      )
                    : undefined
            )
        )
        .orderBy(desc(chatConversations.lastMessageAt), desc(chatConversations.id))
        .limit(options.limit);

    if (page.length === 0) {
        return [];
    }

    /**
     * The newest message of each thread, and how many there are, in one pass.
     *
     * `distinct on` keeps the first row per thread after the ordering, which is the
     * newest; the window function counts the whole partition before that narrowing
     * happens, so the count is of every message and not of the one that survived.
     */
    const tails = await db
        .selectDistinctOn([chatMessages.conversationId], {
            conversationId: chatMessages.conversationId,
            preview: sql<string>`left(${chatMessages.content}, 120)`,
            status: chatMessages.status,
            messageCount: sql<number>`count(*) over (partition by ${chatMessages.conversationId})::int`,
        })
        .from(chatMessages)
        .where(
            inArray(
                chatMessages.conversationId,
                page.map((row) => row.id)
            )
        )
        .orderBy(chatMessages.conversationId, desc(chatMessages.order));

    const byConversation = new Map(tails.map((row) => [row.conversationId, row]));

    return page.map((row) => {
        const tail = byConversation.get(row.id);

        return {
            id: row.id,
            title: row.title,
            lastMessageAt: row.lastMessageAt,
            messageCount: tail?.messageCount ?? 0,
            preview: tail?.preview ?? "",
            lastMessageStatus: tail?.status ?? "ready",
        };
    });
}

/**
 * One page of a thread, newest first.
 *
 * Keyset on `message_order` rather than an offset: a thread grows while it is being
 * read, and an offset would skip or repeat a message every time it did. Returned
 * newest-first because that is the page the screen needs; the caller reverses it.
 */
export async function listMessages(
    db: Db,
    userId: string,
    conversationId: string,
    options: { before?: number; limit: number }
) {
    return db
        .select({
            id: chatMessages.id,
            order: chatMessages.order,
            role: chatMessages.role,
            content: chatMessages.content,
            status: chatMessages.status,
            errorCode: chatMessages.errorCode,
            createdAt: chatMessages.createdAt,
        })
        .from(chatMessages)
        .where(
            and(
                eq(chatMessages.conversationId, conversationId),
                eq(chatMessages.userId, userId),
                options.before === undefined ? undefined : lt(chatMessages.order, options.before)
            )
        )
        .orderBy(desc(chatMessages.order))
        .limit(options.limit);
}

/**
 * The tail of a thread, oldest first, for building the model's context.
 *
 * Deliberately a different query from `listMessages`: what the screen renders and what
 * the model is told are a rendering concern and a cost concern, and tying them
 * together means either sending too much or showing too little.
 */
export async function getRecentMessages(db: Db, userId: string, conversationId: string, limit: number) {
    /**
     * The tail is taken newest-first — that is the only direction an index can give it
     * without reading the whole thread — and turned back the right way round in SQL
     * rather than in JS, so the caller receives a transcript it can hand straight to
     * the model.
     */
    const tail = db
        .select({
            order: chatMessages.order,
            role: chatMessages.role,
            content: chatMessages.content,
            status: chatMessages.status,
        })
        .from(chatMessages)
        .where(and(eq(chatMessages.conversationId, conversationId), eq(chatMessages.userId, userId)))
        .orderBy(desc(chatMessages.order))
        .limit(limit)
        .as("tail");

    return db.select().from(tail).orderBy(asc(tail.order));
}

/** The first message of a thread, kept in context after the window has slid past it. */
export async function getOpeningMessage(db: Db, userId: string, conversationId: string) {
    const [opening] = await db
        .select({ order: chatMessages.order, content: chatMessages.content })
        .from(chatMessages)
        .where(
            and(
                eq(chatMessages.conversationId, conversationId),
                eq(chatMessages.userId, userId),
                eq(chatMessages.role, "user")
            )
        )
        .orderBy(asc(chatMessages.order))
        .limit(1);

    return opening ?? null;
}

/**
 * Hides a thread. Returns false when there was no live thread of this reader's to
 * hide, which the caller reports as 404 — the same answer as a thread that was never
 * theirs, so an id cannot be probed for existence.
 */
export async function softDeleteConversation(db: Db, userId: string, conversationId: string): Promise<boolean> {
    const deleted = await db
        .update(chatConversations)
        .set({ deletedAt: sql`now()` })
        .where(
            and(
                eq(chatConversations.id, conversationId),
                eq(chatConversations.userId, userId),
                isNull(chatConversations.deletedAt)
            )
        )
        .returning({ id: chatConversations.id });

    return deleted.length > 0;
}
