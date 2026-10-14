import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildPromptLanguageRule, getLanguageByIso, languagesData } from "./languageUtils";

/**
 * The address rule is the only instruction every prompt shares, and the only one whose
 * failure is visible in the first sentence a reader sees — a woman told "cítil ses", or a
 * horoscope that switches to the formal form the app's own buttons never use.
 */
describe("buildPromptLanguageRule", () => {
    const czech = getLanguageByIso("cs");

    it("names the language, its locale and its iso", () => {
        assert.ok(czech);

        const rule = buildPromptLanguageRule(czech, "female");

        assert.match(rule, /Čeština/u);
        assert.match(rule, /cs_CZ/u);
    });

    it("asks for feminine forms for a female reader and masculine for a male one", () => {
        assert.ok(czech);

        assert.match(buildPromptLanguageRule(czech, "female"), /feminine/u);
        assert.match(buildPromptLanguageRule(czech, "male"), /masculine/u);
    });

    it("tells the model to write around gender rather than pick one for a non-binary reader", () => {
        assert.ok(czech);

        const rule = buildPromptLanguageRule(czech, "non_binary");

        // The failure mode this guards is a rule that says "write neutrally" and leaves
        // the model to discover that Czech has no neutral past tense.
        assert.match(rule, /present tense/u);
        assert.match(rule, /rewrite the sentence/u);
        assert.doesNotMatch(rule, /every form addressed to them is (masculine|feminine)/u);
    });

    it("asks for the informal form in a language that has one", () => {
        assert.ok(czech);

        assert.match(buildPromptLanguageRule(czech, "female"), /informal second person/u);
    });

    /**
     * The chat is the only caller that returns prose. Told to proofread "the JSON" it is
     * being asked about something that does not exist, and given a nudge towards
     * answering a person with an object.
     */
    it("names what is actually being proofread", () => {
        assert.ok(czech);

        assert.match(buildPromptLanguageRule(czech, "male"), /return the JSON/u);
        assert.match(buildPromptLanguageRule(czech, "male", "json"), /return the JSON/u);

        const prose = buildPromptLanguageRule(czech, "male", "prose");

        assert.doesNotMatch(prose, /JSON/u);
        assert.match(prose, /read it back once/u);
    });

    /**
     * No language offered today uses it (Japanese, Korean, Hindi and Indonesian are hidden
     * until the app is translated), so the rule is checked on a stand-in rather than lost.
     */
    it("asks for the polite register where the plain form would read as rude", () => {
        assert.ok(czech);

        const rule = buildPromptLanguageRule({ ...czech, addressForm: "polite" }, "male");

        assert.match(rule, /polite register/u);
        assert.doesNotMatch(rule, /informal second person/u);
    });
});

describe("languagesData", () => {
    it("gives every language an address form", () => {
        for (const language of languagesData) {
            assert.ok(
                language.addressForm === "informal" || language.addressForm === "polite",
                `${language.iso} has no usable addressForm`
            );
        }
    });

    /**
     * The app offers the same list and sends the iso back as the profile's language, so a
     * code that differs on either side is a reader who cannot finish onboarding.
     */
    it("offers exactly the languages the app is translated into", () => {
        assert.deepEqual(
            languagesData.map((language) => language.iso),
            ["en", "cs", "de", "es", "pt-BR", "fr", "it", "pl"]
        );
    });
});
