import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildConversationTitle } from "./service";
import { MAX_TITLE_LENGTH } from "./types";

describe("buildConversationTitle", () => {
    it("keeps a short question whole, trimmed", () => {
        assert.equal(buildConversationTitle("  Why is my love energy low?  "), "Why is my love energy low?");
    });

    it("collapses the whitespace a multi-line paste brings with it", () => {
        assert.equal(buildConversationTitle("Why is my\n\n  love energy\tlow?"), "Why is my love energy low?");
    });

    it("never exceeds the limit", () => {
        const long = "Why is my love energy so low today and what should I actually do about it this evening";

        assert.ok(long.length > MAX_TITLE_LENGTH);
        assert.ok(buildConversationTitle(long).length <= MAX_TITLE_LENGTH);
    });

    it("cuts on a word boundary, so no word is sliced in half", () => {
        const long = "Why is my love energy so low today and what should I actually do about it this evening";
        const title = buildConversationTitle(long);

        assert.ok(long.startsWith(title), "the title is a prefix of the question");
        // The character the cut landed on is a space, which is what makes it a boundary.
        assert.equal(long[title.length], " ");
    });

    /**
     * The boundary is only honoured when it leaves a usable title behind. A pasted URL,
     * or a language that does not space its words, has no boundary to cut on — and a
     * title of the first four characters would be worse than a hard cut.
     */
    it("falls back to a hard cut when the first word fills the title", () => {
        assert.equal(buildConversationTitle("x".repeat(200)).length, MAX_TITLE_LENGTH);
    });

    it("falls back to a hard cut when the boundary is uselessly early", () => {
        const title = buildConversationTitle(`ok ${"x".repeat(200)}`);

        assert.equal(title.length, MAX_TITLE_LENGTH);
        assert.ok(title.startsWith("ok x"));
    });

    it("never ends in a trailing space", () => {
        const title = buildConversationTitle(`${"word ".repeat(20)}end`);

        assert.equal(title, title.trimEnd());
    });

    it("carries diacritics through unharmed", () => {
        assert.equal(buildConversationTitle("Proč mám dnes nízkou lásku?"), "Proč mám dnes nízkou lásku?");
    });
});
