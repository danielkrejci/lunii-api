import { Content } from "@google/genai";
import { FastifyBaseLogger, FastifyInstance } from "fastify";

import { aiGenerations } from "../../db/schema";
import { ai } from "../../lib/ai";
import { creditKeys } from "../credits/keys";
import { refundUnlock } from "../credits/service";
import { completeMessage, failMessage, writePartialContent } from "./service";
import { SseChannel } from "./sse";
import { ChatErrorCode } from "./types";

type Db = FastifyInstance["db"];

const MODEL = "gemini-2.5-flash";

/**
 * List price per million tokens, so the logged cost is what was actually charged. The
 * same numbers modules/insights and modules/insights/planets each keep their own copy
 * of; this is the third, and the day one of them changes is the day they should be one.
 */
const PRICE_PER_MILLION = { input: 0.3, output: 2.5 };

/**
 * A ceiling, not a target. Two or three paragraphs is what the prompt asks for; this is
 * here so a question that sends the model into an essay cannot run up a bill or hold a
 * connection open for a minute.
 */
const MAX_OUTPUT_TOKENS = 1200;

/**
 * How often the answer so far reaches the database.
 *
 * Both conditions have to hold: at least a second since the last write, and at least
 * this many new characters. Together they cap the write rate at one a second while a
 * fast stream is arriving, and stop a slow trickle from writing on every token.
 *
 * The write is also the heartbeat that keeps the stuck-run sweeper away, which is why
 * this is well under the five-minute timeout.
 */
const FLUSH_INTERVAL_MS = 1000;
const FLUSH_CHARS = 500;

/**
 * Writes one answer: to the socket as it arrives, and to the database once it is whole.
 *
 * Never throws. Every way this can fail ends with the message marked `failed` and an
 * audit row written, because the caller has already hijacked the response and has no
 * way left to report an exception.
 *
 * The client is not what drives this. A reader who backgrounds the app or loses signal
 * stops receiving frames, and the loop carries on to the end and stores the answer — it
 * has been paid for either way, and finding it finished on the way back is worth far
 * more than saving the few seconds of generation that were left.
 */
export async function runChatGeneration(input: {
    db: Db;
    log: FastifyBaseLogger;
    channel: SseChannel;
    userId: string;
    messageId: string;
    /** The claim taken when the row was created, or re-taken by a retry. */
    claimedAt: Date;
    systemInstruction: string;
    contents: Content[];
}): Promise<void> {
    const { db, log, channel, messageId } = input;

    const startedAt = Date.now();

    let claimedAt = input.claimedAt;
    let answer = "";
    let flushedAt = Date.now();
    let flushedLength = 0;

    let requestId = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;
    let finishReason = "";
    let failure: string | null = null;

    try {
        const stream = await ai.models.generateContentStream({
            model: MODEL,
            contents: input.contents,
            config: {
                systemInstruction: input.systemInstruction,
                /**
                 * Off, as in every other generator here. Measured on the daily prompt it
                 * cost 40 % more and 20 seconds for nothing; in a conversation the first
                 * visible token is most of the experience, and thinking delays exactly
                 * that.
                 */
                thinkingConfig: { thinkingBudget: 0 },
                maxOutputTokens: MAX_OUTPUT_TOKENS,
                // Deliberately no response schema: this streams prose to a person, and
                // JSON mode would make the client parse half-written objects.
            },
        });

        for await (const chunk of stream) {
            requestId = chunk.responseId ?? requestId;
            finishReason = chunk.candidates?.[0]?.finishReason ?? finishReason;

            if (chunk.usageMetadata) {
                inputTokens = chunk.usageMetadata.promptTokenCount ?? inputTokens;
                // Thinking tokens bill at the output rate but sit outside
                // `candidatesTokenCount`. Counted here so the audit row is the charge.
                outputTokens =
                    (chunk.usageMetadata.candidatesTokenCount ?? 0) + (chunk.usageMetadata.thoughtsTokenCount ?? 0);
                totalTokens = chunk.usageMetadata.totalTokenCount ?? totalTokens;
            }

            const text = chunk.text ?? "";

            if (!text) {
                continue;
            }

            answer += text;

            channel.send("delta", { text });
            await channel.flush();

            if (Date.now() - flushedAt >= FLUSH_INTERVAL_MS && answer.length - flushedLength >= FLUSH_CHARS) {
                const rolled = await writePartialContent(db, { messageId, claimedAt, content: answer });

                if (!rolled) {
                    /**
                     * The row moved on — a retry claimed it, or the sweeper timed it out
                     * while this run was quiet. Someone else owns the answer now, so
                     * stop rather than race them, and leave their state alone.
                     */
                    log.warn({ messageId }, "Chat generation lost its claim mid-stream");

                    channel.close();

                    return;
                }

                claimedAt = rolled;
                flushedAt = Date.now();
                flushedLength = answer.length;
            }
        }

        if (!answer.trim()) {
            failure = `model returned no text (finishReason: ${finishReason || "unknown"})`;
        }
    } catch (error: unknown) {
        failure = error instanceof Error ? error.message : String(error);

        log.error({ err: error, messageId }, "Chat generation failed");
    }

    const errorCode: ChatErrorCode = "generation_failed";

    const failed = failure ? await failMessage(db, { messageId, claimedAt, errorCode, content: answer }) : null;
    const stored = failure ? failed !== null : await completeMessage(db, { messageId, claimedAt, content: answer });

    /**
     * An answer that never arrived is given back. Keyed on the send that paid for it,
     * which the assistant row carries precisely so this path can find it — a retry
     * overwrites it, so what is refunded is always the attempt that just failed.
     *
     * Never allowed to be the reason the failure itself goes unrecorded.
     */
    if (failed?.chargeKey) {
        await refundUnlock(db, {
            userId: input.userId,
            feature: "chatMessage",
            resourceKey: creditKeys.chatMessage(failed.chargeKey),
        }).catch((error: unknown) => log.error({ err: error, messageId }, "Failed to refund a chat credit"));
    }

    if (!stored) {
        // Nothing matched: the row moved on while the model was writing. Worth saying
        // out loud — the answer was paid for and then thrown away.
        log.warn({ messageId }, "Finished chat answer discarded, the row had moved on");
    }

    /**
     * The audit row is the only place the prompt, the answer and the price survive, and
     * it must never be the reason a finished answer is lost.
     */
    await db
        .insert(aiGenerations)
        .values({
            userId: input.userId,
            type: "chat",
            status: failure ? "error" : "success",
            error: failure,
            requestId,
            provider: "google",
            model: MODEL,
            // One string, like every other generator's row, so reviewing these later is
            // the same job whichever type they are.
            input: `${input.systemInstruction}\n\n${transcriptOf(input.contents)}`,
            output: answer,
            inputTokens,
            outputTokens,
            // `total_tokens`, not `totalTokens`: the column's property name in schema.ts.
            total_tokens: totalTokens || inputTokens + outputTokens,
            latencyMs: Date.now() - startedAt,
            cost:
                (inputTokens / 1_000_000) * PRICE_PER_MILLION.input +
                (outputTokens / 1_000_000) * PRICE_PER_MILLION.output,
        })
        .catch((error: unknown) => log.error({ err: error, messageId }, "Failed to log AI generation"));

    if (failure) {
        channel.send("error", {
            messageId,
            code: errorCode,
            message: "Lunii couldn't finish that answer.",
            retryable: true,
        });
    } else {
        channel.send("done", { messageId, status: "ready", chars: answer.length });
    }

    channel.close();
}

/** The transcript as one readable block, for the audit row. */
function transcriptOf(contents: Content[]): string {
    return contents.map((content) => `--- ${content.role} ---\n${content.parts?.[0]?.text ?? ""}`).join("\n\n");
}
