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

    it("asks for the polite register where the plain form would read as rude", () => {
        const japanese = getLanguageByIso("ja");

        assert.ok(japanese);

        const rule = buildPromptLanguageRule(japanese, "male");

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

    it("keeps the languages that have politeness levels out of the informal bucket", () => {
        for (const iso of ["ja", "ko"]) {
            assert.equal(getLanguageByIso(iso)?.addressForm, "polite", `${iso} must not be addressed informally`);
        }
    });
});
