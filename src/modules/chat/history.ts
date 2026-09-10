import { Content } from "@google/genai";

import { ChatMessageStatus, ChatRole } from "./types";

/**
 * How much of a conversation the model is told about, and in what shape.
 *
 * Pure on purpose: this is the decision that sets the cost and most of the quality of
 * every turn, and it is worth being able to test without a database or a model.
 */

/**
 * The window, in messages. Eight exchanges.
 *
 * Chosen against the case the feature exists for — "what did you mean by that?" — which
 * needs two. The rest is headroom for a reader who circles a subject for a while. Past
 * this the marginal message is nearly always something neither of them refers to again,
 * and it is paid for on every turn thereafter.
 */
export const MAX_TURNS = 16;

/**
 * The window, in characters, whichever binds first.
 *
 * Sixteen short exchanges and sixteen long ones are not the same request. Roughly
 * 2 500 tokens, which with the reader and the day around it keeps a turn near 4 500 in.
 */
export const MAX_CHARS = 9000;

/**
 * How many rows to read for a window of MAX_TURNS.
 *
 * More than the window, because some of what comes back is dropped before the budget
 * is applied: the empty answer this turn is about to be written into, and any failed
 * attempt still sitting in the thread.
 */
export const HISTORY_FETCH_LIMIT = MAX_TURNS + 6;

/** A stored message, as `getRecentMessages` returns it. Oldest first. */
export interface HistoryMessage {
    order: number;
    role: ChatRole;
    content: string;
    status: ChatMessageStatus;
}

export interface BuiltHistory {
    /** Ready for `contents`. Roles are Gemini's — `model`, not `assistant`. */
    contents: Content[];
    /** Stored messages the window kept. Worth logging: it is the cost of the turn. */
    kept: number;
    /** True when the window had slid past the opening question and it was carried back. */
    carriedOpening: boolean;
}

/**
 * What is worth telling the model about.
 *
 * A failed attempt is dropped whole rather than included as far as it got: half an
 * answer is not what was said, and asking the model to continue from a sentence that
 * broke off invites it to treat the break as meaningful.
 *
 * An answer with no text yet is the row this turn is about to write into — on a retry
 * it has just been cleared. Either way it is a placeholder, not a turn.
 */
function isUsable(message: HistoryMessage): boolean {
    if (message.status === "failed") {
        return false;
    }

    return !(message.role === "assistant" && message.content.trim() === "");
}

/**
 * The transcript for one turn: a window of what was said, and today attached to the
 * question being asked now.
 *
 * The day block rides on the last reader turn rather than leading the transcript, for
 * two reasons. A thread picked up tomorrow must not reason from a block describing
 * yesterday that happens to sit at the top of it. And everything before the last turn
 * is identical from one request to the next, so a volatile block at the front would
 * invalidate the cached prefix on every day boundary; at the back it invalidates
 * nothing.
 */
export function buildHistory(input: {
    /** The tail of the thread, oldest first, including the question just stored. */
    messages: HistoryMessage[];
    /** Today, as `buildDayContext` wrote it. */
    dayContext: string;
    /**
     * The question that opened the thread, when it lies outside the window. Kept
     * because a long conversation drifts, and the thing it drifts away from is
     * usually the only reason any of it makes sense.
     */
    opening?: { order: number; content: string } | null;
    /**
     * The last thing the model reads before it answers.
     *
     * The horoscope prompt ends the same way and says so — "It is repeated at the end;
     * check it again before you answer" — because a rule stated once at the top of a
     * long prompt is a rule the model has stopped attending to by the time it writes.
     * Measured here: with the address rule only in the system instruction, a male
     * reader was answered in feminine forms.
     */
    closing?: string;
}): BuiltHistory {
    const usable = input.messages.filter(isUsable);

    const window: HistoryMessage[] = [];
    let chars = 0;

    for (let index = usable.length - 1; index >= 0; index--) {
        const message = usable[index];

        if (window.length >= MAX_TURNS) {
            break;
        }

        // The budget never empties the window: one message over it is still the
        // question that was asked, and it is capped at MAX_MESSAGE_LENGTH anyway.
        if (window.length > 0 && chars + message.content.length > MAX_CHARS) {
            break;
        }

        window.unshift(message);
        chars += message.content.length;
    }

    /**
     * Gemini reads a transcript that opens with an answer as an answer to nothing. The
     * budget can land there, so trim back to the first thing the reader said.
     */
    while (window.length > 0 && window[0].role === "assistant") {
        window.shift();
    }

    const opening = input.opening;
    const carriedOpening = opening !== null && opening !== undefined && (window[0]?.order ?? Infinity) > opening.order;

    const contents: Content[] = [];

    if (carriedOpening && opening) {
        contents.push({ role: "user", parts: [{ text: opening.content }] });
    }

    for (const message of window) {
        contents.push({
            role: message.role === "assistant" ? "model" : "user",
            parts: [{ text: message.content }],
        });
    }

    attachToQuestion(contents, { dayContext: input.dayContext, closing: input.closing });

    return { contents, kept: window.length, carriedOpening };
}

/**
 * Wraps the question being asked now: the day in front of it, the closing rule behind.
 *
 * Today goes first so the model reads the situation before what is asked of it — the
 * order every other prompt here uses. The closing rule goes last because last is the
 * only position that reliably survives a long prompt.
 */
function attachToQuestion(contents: Content[], input: { dayContext: string; closing?: string }): void {
    const before = input.dayContext.trim();
    const after = input.closing?.trim() ?? "";

    if (!before && !after) {
        return;
    }

    for (let index = contents.length - 1; index >= 0; index--) {
        if (contents[index].role !== "user") {
            continue;
        }

        const question = contents[index].parts?.[0]?.text ?? "";

        contents[index] = {
            role: "user",
            parts: [{ text: [before, question, after].filter(Boolean).join("\n\n") }],
        };

        return;
    }

    // No reader turn survived the window — nothing to attach to, and a transcript of
    // one block with no question would be answered as if it were one.
    contents.push({ role: "user", parts: [{ text: [before, after].filter(Boolean).join("\n\n") }] });
}
