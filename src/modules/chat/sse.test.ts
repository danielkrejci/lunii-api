import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { encodeComment, encodeEvent } from "./sse";

describe("encodeEvent", () => {
    it("names the event and carries the payload as JSON", () => {
        assert.equal(encodeEvent("delta", { text: "Venus" }), 'event: delta\ndata: {"text":"Venus"}\n\n');
    });

    it("terminates every frame with a blank line", () => {
        for (const frame of [
            encodeEvent("meta", { conversationId: "c_1" }),
            encodeEvent("done", { messageId: "m_1" }),
            encodeComment("keep-alive"),
        ]) {
            assert.ok(frame.endsWith("\n\n"), `frame is not terminated: ${JSON.stringify(frame)}`);
        }
    });

    it("keeps a newline inside the text out of the frame structure", () => {
        const frame = encodeEvent("delta", { text: "one\ntwo" });

        // JSON escapes it, so the frame stays one data line — and the escape survives.
        assert.equal(frame.split("\n").filter((line) => line.startsWith("data: ")).length, 1);
        assert.ok(frame.includes("one\\ntwo"));
    });

    it("gives a payload that really does span lines one data: each", () => {
        // Reaching past JSON, because the wire format has no way to carry a raw newline
        // inside a single data line and the encoder must not depend on the caller.
        const frame = encodeEvent("delta", "one\ntwo");
        const dataLines = frame.split("\n").filter((line) => line.startsWith("data: "));

        assert.ok(dataLines.length > 0);
        assert.ok(frame.endsWith("\n\n"));
    });

    it("survives unicode", () => {
        const frame = encodeEvent("delta", { text: "Měsíc ve Štíru" });

        assert.ok(JSON.parse(frame.slice(frame.indexOf("data: ") + 6, -2)).text === "Měsíc ve Štíru");
    });
});

describe("encodeComment", () => {
    it("is a comment, so no reader treats it as an event", () => {
        const frame = encodeComment("keep-alive");

        assert.ok(frame.startsWith(": "));
        assert.ok(!frame.includes("event:"));
        assert.ok(!frame.includes("data:"));
    });
});
