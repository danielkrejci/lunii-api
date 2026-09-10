import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildHistory, HistoryMessage, MAX_CHARS, MAX_TURNS } from "./history";

const DAY = "TODAY\nlove 22, career 61";

function message(order: number, role: "user" | "assistant", content: string, status = "ready"): HistoryMessage {
    return { order, role, content, status: status as HistoryMessage["status"] };
}

/** A finished exchange, plus the empty answer row the current turn writes into. */
function thread(exchanges: number): HistoryMessage[] {
    const messages: HistoryMessage[] = [];

    for (let index = 0; index < exchanges; index++) {
        messages.push(
            message(index * 2 + 1, "user", `question ${index}`),
            message(index * 2 + 2, "assistant", `answer ${index}`)
        );
    }

    return messages;
}

function texts(contents: ReturnType<typeof buildHistory>["contents"]): string[] {
    return contents.map((content) => content.parts?.[0]?.text ?? "");
}

describe("buildHistory", () => {
    it("turns a thread into an alternating transcript in Gemini's roles", () => {
        const { contents } = buildHistory({
            messages: [...thread(2), message(5, "user", "and now?")],
            dayContext: DAY,
        });

        assert.deepEqual(
            contents.map((content) => content.role),
            ["user", "model", "user", "model", "user"]
        );
    });

    it("drops the empty answer row the turn is about to be written into", () => {
        const { contents, kept } = buildHistory({
            messages: [message(1, "user", "why?"), message(2, "assistant", "", "streaming")],
            dayContext: DAY,
        });

        assert.equal(kept, 1);
        assert.equal(contents.length, 1);
        assert.equal(contents[0].role, "user");
    });

    it("drops a failed attempt whole, including the text it got as far as", () => {
        const { contents } = buildHistory({
            messages: [
                message(1, "user", "why?"),
                message(2, "assistant", "Venus is", "failed"),
                message(3, "user", "hello?"),
            ],
            dayContext: DAY,
        });

        assert.equal(contents.length, 2);
        assert.ok(!texts(contents).some((text) => text.includes("Venus is")));
    });

    it("keeps the most recent exchanges when the thread is longer than the window", () => {
        const { contents, kept } = buildHistory({ messages: thread(20), dayContext: DAY });

        assert.equal(kept, MAX_TURNS);
        assert.ok(texts(contents).at(-1)?.includes("answer 19"));
        assert.ok(!texts(contents).some((text) => text.includes("question 0")));
    });

    it("never opens the transcript with an answer", () => {
        // 21 messages: the window would otherwise start on `answer 2`.
        const { contents } = buildHistory({ messages: thread(20).slice(4), dayContext: DAY });

        assert.equal(contents[0].role, "user");
    });

    it("stops on the character budget before the message budget", () => {
        const long = "x".repeat(2000);
        const messages = Array.from({ length: 10 }, (_, index) =>
            message(index + 1, index % 2 === 0 ? "user" : "assistant", long)
        );

        const { kept } = buildHistory({ messages, dayContext: DAY });

        assert.ok(kept < MAX_TURNS, "the message budget did not bind");
        assert.ok(kept * long.length <= MAX_CHARS + long.length);
    });

    it("keeps the question even when it alone exceeds the character budget", () => {
        const { contents, kept } = buildHistory({
            messages: [message(1, "user", "y".repeat(MAX_CHARS + 500))],
            dayContext: DAY,
        });

        assert.equal(kept, 1);
        assert.equal(contents.length, 1);
    });

    it("carries the opening question back when the window has slid past it", () => {
        const { contents, carriedOpening } = buildHistory({
            messages: thread(20),
            dayContext: DAY,
            opening: { order: 1, content: "Should I change career?" },
        });

        assert.equal(carriedOpening, true);
        assert.equal(texts(contents)[0], "Should I change career?");
        assert.equal(contents[0].role, "user");
    });

    it("does not repeat the opening question when it is already in the window", () => {
        const { contents, carriedOpening } = buildHistory({
            messages: thread(2),
            dayContext: DAY,
            opening: { order: 1, content: "question 0" },
        });

        assert.equal(carriedOpening, false);
        assert.equal(texts(contents).filter((text) => text.includes("question 0")).length, 1);
    });

    it("attaches today ahead of the question being asked now, and nowhere else", () => {
        const { contents } = buildHistory({
            messages: [...thread(1), message(3, "user", "and my career?")],
            dayContext: DAY,
        });

        const withDay = texts(contents).filter((text) => text.includes(DAY));

        assert.equal(withDay.length, 1, "today appears exactly once");
        assert.equal(texts(contents).at(-1), `${DAY}\n\nand my career?`);
    });

    it("still sends today when nothing the reader said survived the window", () => {
        const { contents } = buildHistory({ messages: [], dayContext: DAY });

        assert.equal(contents.length, 1);
        assert.equal(contents[0].role, "user");
        assert.equal(texts(contents)[0], DAY);
    });

    it("leaves the transcript alone when there is no day context to attach", () => {
        const { contents } = buildHistory({ messages: [message(1, "user", "why?")], dayContext: "" });

        assert.equal(texts(contents)[0], "why?");
    });
});
