import dayjs from "dayjs";
import { and, desc, eq } from "drizzle-orm";

import { db } from "../db";
import { aiGenerations, chatConversations, chatMessages, profile as profileTable } from "../db/schema";
import { buildDayContext } from "../modules/chat/context";
import { buildHistory, HISTORY_FETCH_LIMIT } from "../modules/chat/history";
import { buildChatSystemPrompt, buildClosingLanguageRule } from "../modules/chat/prompt";
import { claimRetry, getRecentMessages, listMessages, startTurn } from "../modules/chat/service";
import { SseChannel, SseEvent } from "../modules/chat/sse";
import { runChatGeneration } from "../modules/chat/stream";

/**
 * Drives one real chat turn end to end: real prompt, real Gemini stream, real rows.
 *
 * Costs about one cent in model calls and creates one conversation, which it deletes on
 * the way out. What it cannot check is the wire — whether a proxy buffers the stream is
 * a question only `curl -N` through the tunnel can answer.
 *
 *   pnpm tsx src/scripts/testChatStream.ts
 */

let failures = 0;

function check(label: string, condition: boolean, detail?: unknown) {
    if (condition) {
        console.log(`  ok    ${label}`);
    } else {
        failures++;
        console.error(`  FAIL  ${label}`, detail === undefined ? "" : detail);
    }
}

interface Recorded {
    event: SseEvent;
    data: unknown;
    at: number;
}

/** A channel that records instead of writing, so the loop can be watched. */
function recordingChannel(): SseChannel & { frames: Recorded[]; closed: boolean } {
    const frames: Recorded[] = [];
    let closed = false;

    return {
        frames,
        get closed() {
            return closed;
        },
        get alive() {
            return !closed;
        },
        send(event, data) {
            frames.push({ event, data, at: Date.now() });
        },
        async flush() {},
        close() {
            closed = true;
        },
    };
}

async function main() {
    const date = dayjs().format("YYYY-MM-DD");
    const [profile] = await db.select().from(profileTable).limit(1);

    if (!profile) {
        console.error("No profiles in the database.");
        process.exit(1);
    }

    console.log(`profile ${profile.name} (${profile.userId}), ${profile.language}\ndate    ${date}\n`);

    const systemInstruction = buildChatSystemPrompt({ reader: profile, languageIso: profile.language });
    const dayContext = await buildDayContext(db, { userId: profile.userId, profile, date });
    const closing = buildClosingLanguageRule({ reader: profile, languageIso: profile.language });

    let conversationId: string | null = null;

    try {
        /* ---------- a real answer ---------- */

        console.log("streaming a real answer");

        const turn = await startTurn(db, {
            userId: profile.userId,
            conversationId: null,
            content: "Proč mám dnes tak nízkou lásku?",
            clientId: crypto.randomUUID(),
        });

        if (!turn) {
            throw new Error("startTurn returned null");
        }

        conversationId = turn.conversationId;

        const messages = await getRecentMessages(db, profile.userId, conversationId, HISTORY_FETCH_LIMIT);
        const { contents } = buildHistory({ messages, dayContext, closing });

        const channel = recordingChannel();
        const startedAt = Date.now();

        await runChatGeneration({
            db,
            log: console as never,
            channel,
            userId: profile.userId,
            messageId: turn.assistantMessage.id,
            claimedAt: turn.assistantMessage.claimedAt,
            systemInstruction,
            contents,
        });

        const deltas = channel.frames.filter((frame) => frame.event === "delta");
        const done = channel.frames.find((frame) => frame.event === "done");
        const answer = deltas.map((frame) => (frame.data as { text: string }).text).join("");

        check("the model answered", answer.length > 0, answer.length);
        check("it arrived in more than one piece", deltas.length > 1, `${deltas.length} delta(s)`);
        check("the stream ended with done", done !== undefined);
        check("no error frame", !channel.frames.some((frame) => frame.event === "error"));
        check("the channel was closed", channel.closed);

        if (deltas.length > 1) {
            const first = deltas[0].at - startedAt;
            const last = deltas.at(-1)!.at - startedAt;

            console.log(`        first token after ${first} ms, last after ${last} ms, ${answer.length} chars`);
            check("tokens were spread over time, not delivered at once", last - first > 100, `${last - first} ms`);
        }

        const [stored] = await listMessages(db, profile.userId, conversationId, { limit: 1 });

        check("the row is ready", stored.status === "ready", stored.status);
        check("and holds exactly what was streamed", stored.content === answer);

        const [audit] = await db
            .select()
            .from(aiGenerations)
            .where(and(eq(aiGenerations.userId, profile.userId), eq(aiGenerations.type, "chat")))
            .orderBy(desc(aiGenerations.createdAt))
            .limit(1);

        check("an audit row was written", audit !== undefined);
        check("with the tokens it was charged for", (audit?.inputTokens ?? 0) > 0 && (audit?.outputTokens ?? 0) > 0);
        check("and a price", (audit?.cost ?? 0) > 0, audit?.cost);
        console.log(
            `        ${audit?.inputTokens} in, ${audit?.outputTokens} out, ${audit?.latencyMs} ms, $${audit?.cost}`
        );

        console.log(`\n--- the answer ---\n${answer}\n------------------\n`);

        /* ---------- a failure, and the retry that follows it ---------- */

        console.log("failing a turn on purpose");

        const failing = await startTurn(db, {
            userId: profile.userId,
            conversationId,
            content: "Tahle otázka selže.",
            clientId: crypto.randomUUID(),
        });

        const failChannel = recordingChannel();

        await runChatGeneration({
            db,
            log: { warn() {}, error() {} } as never,
            channel: failChannel,
            userId: profile.userId,
            messageId: failing!.assistantMessage.id,
            claimedAt: failing!.assistantMessage.claimedAt,
            systemInstruction,
            // Empty: the API rejects it, which exercises the catch branch for real.
            contents: [],
        });

        const errorFrame = failChannel.frames.find((frame) => frame.event === "error");

        check("the client is told it failed", errorFrame !== undefined);
        check("and that it can retry", (errorFrame?.data as { retryable: boolean })?.retryable === true);
        check("no done frame", !failChannel.frames.some((frame) => frame.event === "done"));

        const [failed] = await listMessages(db, profile.userId, conversationId, { limit: 1 });

        check("the row is failed", failed.status === "failed", failed.status);
        check("with a code the client can localise", failed.errorCode === "generation_failed", failed.errorCode);

        const [failAudit] = await db
            .select({ status: aiGenerations.status, error: aiGenerations.error })
            .from(aiGenerations)
            .where(and(eq(aiGenerations.userId, profile.userId), eq(aiGenerations.type, "chat")))
            .orderBy(desc(aiGenerations.createdAt))
            .limit(1);

        check("the failure is audited too", failAudit?.status === "error", failAudit?.error);

        console.log("\nretrying it");

        const claimed = await claimRetry(db, {
            userId: profile.userId,
            conversationId,
            messageId: failing!.assistantMessage.id,
        });

        check("the failed answer can be claimed back", claimed !== null);

        const retryMessages = await getRecentMessages(db, profile.userId, conversationId, HISTORY_FETCH_LIMIT);
        const retryChannel = recordingChannel();

        await runChatGeneration({
            db,
            log: console as never,
            channel: retryChannel,
            userId: profile.userId,
            messageId: failing!.assistantMessage.id,
            claimedAt: claimed!.claimedAt,
            systemInstruction,
            contents: buildHistory({ messages: retryMessages, dayContext, closing }).contents,
        });

        const [retried] = await listMessages(db, profile.userId, conversationId, { limit: 1 });

        check("the retry landed", retried.status === "ready", retried.status);
        check("the error code was cleared", retried.errorCode === null);
        check("and the position never moved", retried.order === failing!.assistantMessage.order);

        /* ---------- a run that loses its claim ---------- */

        console.log("\nlosing the claim mid-stream");

        const orphan = await startTurn(db, {
            userId: profile.userId,
            conversationId,
            content: "Tahle poběží, ale řádek jí vezmeme.",
            clientId: crypto.randomUUID(),
        });

        // Someone else touches the row, so this run's claim is now stale.
        await db
            .update(chatMessages)
            .set({ status: "failed", updatedAt: new Date() })
            .where(eq(chatMessages.id, orphan!.assistantMessage.id));

        const orphanChannel = recordingChannel();

        await runChatGeneration({
            db,
            log: { warn() {}, error() {} } as never,
            channel: orphanChannel,
            userId: profile.userId,
            messageId: orphan!.assistantMessage.id,
            claimedAt: orphan!.assistantMessage.claimedAt,
            systemInstruction,
            contents: buildHistory({ messages: retryMessages, dayContext, closing }).contents,
        });

        const [untouched] = await db
            .select({ status: chatMessages.status, content: chatMessages.content })
            .from(chatMessages)
            .where(eq(chatMessages.id, orphan!.assistantMessage.id));

        check("a run with a stale claim does not overwrite the row", untouched.status === "failed", untouched.status);
    } finally {
        if (conversationId) {
            await db.delete(chatMessages).where(eq(chatMessages.conversationId, conversationId));
            await db.delete(chatConversations).where(eq(chatConversations.id, conversationId));
            console.log("\ncleaned up");
        }
    }

    console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
