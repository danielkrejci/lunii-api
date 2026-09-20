import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NatalAspect, NatalChart } from "../../modules/astro";
import { buildPrompt } from "./generate";

const chart = {
    sun: { sign: "gemini", longitude: 80 },
    moon: { sign: "aquarius", longitude: 310 },
    mercury: { sign: "gemini", longitude: 75 },
    venus: { sign: "taurus", longitude: 45 },
    mars: { sign: "aries", longitude: 10 },
    jupiter: { sign: "cancer", longitude: 100 },
    saturn: { sign: "capricorn", longitude: 280 },
    uranus: { sign: "capricorn", longitude: 275 },
    neptune: { sign: "capricorn", longitude: 285 },
    pluto: { sign: "scorpio", longitude: 225 },
} as unknown as NatalChart;

const aspects = [
    { a: "sun", b: "saturn", aspect: "square", group: "hard", orb: 1.2, strength: 0.8 },
] as unknown as NatalAspect[];

const input = {
    chart,
    aspects,
    sunSign: "gemini",
    risingSign: "leo" as string | null,
    relationshipStatus: "in_a_relationship",
    careerStage: "changing_field",
    decisionStyle: "do_my_research",
    areasOfInterest: ["career", "self_development"],
    contentPreference: "practical",
    beliefLevel: "curious_sceptic",
    language: "Respond in Czech.",
};

describe("buildPrompt", () => {
    /**
     * The repetition is measured behaviour, not redundancy: the rule buried at the end of
     * a long prompt is the one the model reaches back for, so it sits at both ends.
     */
    it("states the language rule at the top and again at the bottom", () => {
        const prompt = buildPrompt(input);

        assert.equal(prompt.match(/Respond in Czech\./gu)?.length, 2);
        assert.match(prompt.slice(0, 400), /Respond in Czech\./u);
        assert.match(prompt.slice(-200), /Respond in Czech\./u);
    });

    it("humanizes the enum keys the client sends", () => {
        const prompt = buildPrompt(input);

        assert.match(prompt, /do my research/u);
        assert.match(prompt, /changing field/u);
        assert.match(prompt, /in a relationship/u);
        assert.match(prompt, /career, self development/u);

        // The underscored form must never survive into a prompt.
        for (const raw of ["do_my_research", "changing_field", "in_a_relationship", "self_development"]) {
            assert.doesNotMatch(prompt, new RegExp(raw, "u"));
        }
    });

    it("asks for exactly the three sections when there is a birth time", () => {
        const output = buildPrompt(input).split("OUTPUT")[1].split("HOW TO WRITE IT")[0];

        for (const key of ["yourSign", "yourAscendant", "inYourLife"]) {
            assert.match(output, new RegExp(`"${key}"`, "u"));
        }

        for (const gone of ["core", "emotions", "expression", "howYouWork", "whatYoureReallyAfter"]) {
            assert.doesNotMatch(output, new RegExp(`"${gone}"`, "u"), `old section ${gone} still requested`);
        }
    });

    /**
     * No birth time means no Ascendant, so the section must be impossible rather than
     * merely discouraged — and the reader is never told a section is missing.
     */
    it("drops the Ascendant section entirely when there is no birth time", () => {
        const prompt = buildPrompt({ ...input, risingSign: null });

        assert.doesNotMatch(prompt.split("SECTIONS")[1], /yourAscendant/u);
        assert.doesNotMatch(prompt, /"yourAscendant"/u);
        assert.match(prompt, /unknown — no birth time was given/u);

        // The remaining sections are renumbered, not left with a hole.
        assert.match(prompt, /2\. inYourLife/u);
        assert.doesNotMatch(prompt, /3\. inYourLife/u);
    });

    it("explains what an Ascendant is when there is a birth time", () => {
        const prompt = buildPrompt(input);

        assert.match(prompt, /2\. yourAscendant/u);
        assert.match(prompt, /3\. inYourLife/u);
        assert.match(prompt, /They do not know what an\n   Ascendant is, so assume nothing/u);
        assert.match(prompt, /it\n   moves a whole sign every two hours/u);
        // Their actual Rising sign has to reach the brief, not just the chart block.
        assert.match(prompt.split("SECTIONS")[1], /Theirs is leo/u);
    });

    /**
     * Every section is paragraphs, and the two opening ones are deliberately the short way
     * in rather than the reading itself.
     */
    it("asks for every section as paragraphs, the first two short", () => {
        const output = buildPrompt(input).split("OUTPUT")[1].split("HOW TO WRITE IT")[0];

        assert.match(output, /"yourSign": \["string", "string"\]/u);
        assert.match(output, /"yourAscendant": \["string", "string"\]/u);
        assert.match(output, /ONE PARAGRAPH PER ARRAY ENTRY, in every field/u);

        assert.match(output, /yourSign: exactly 2 entries, 2 sentences each/u);
        assert.match(output, /The first two sections are short on purpose/u);

        // No section may be asked for as a bare string any more.
        assert.doesNotMatch(output, /": "string"/u);
    });

    /**
     * This route is the one place in the app allowed to name the astrology, and the ban it
     * overrides lives in the shared voice rules, so the override has to be explicit —
     * `REASON_RULES` documents what happens when a prompt bans and asks at the same time.
     */
    it("lifts the ban on naming the astrology", () => {
        const prompt = buildPrompt(input);

        assert.match(prompt, /NAME THE ASTROLOGY HERE — THIS IS THE EXCEPTION/u);
        assert.doesNotMatch(prompt, /No astrology vocabulary, no zodiac names/u);
        // But the jargon with no payoff stays out.
        assert.match(prompt, /degrees, orbs, houses/u);
    });

    /**
     * Naming the astrology makes the text accountable for it. A real generation called a
     * square a conjunction — free to do once nothing checked it, and a factual claim about
     * this person's chart that any reader who knows charts will catch.
     */
    it("forbids naming the aspect it could get wrong", () => {
        const prompt = buildPrompt(input);

        assert.match(prompt, /NAME THE PLANETS, NEVER THE ANGLE BETWEEN THEM/u);
        assert.match(prompt, /not conjunction, not square, not trine, opposition or\nsextile/u);
        // And the vague dodge that replaces a banned word is banned too.
        assert.match(prompt, /because of the influences in your chart/u);
    });

    it("counts sentences rather than characters", () => {
        const prompt = buildPrompt(input);

        assert.match(prompt, /Count sentences, not characters\./u);
        assert.doesNotMatch(prompt, /at most \d+ characters/u);
    });

    it("says there is no standing aspect rather than leaving the list empty", () => {
        const prompt = buildPrompt({ ...input, aspects: [] });

        assert.match(prompt, /no close aspect to itself/u);
    });

    /**
     * The regression this guards is one the prompt caused itself: the third section used
     * to be briefed as "what is different on Monday", and the profile came back reading as
     * a daily horoscope. The shared voice rules are written for one and say "today" nine
     * times, so this prompt has to say the opposite louder than they say it.
     */
    it("asks for a person rather than a day", () => {
        const prompt = buildPrompt(input);

        assert.match(prompt, /A PERSON, NOT A DAY/u);
        assert.match(prompt, /There is no today here\./u);
        assert.match(prompt, /Present tense, and permanent\./u);
        assert.match(prompt, /This is analysis, not a plan\./u);
        assert.match(prompt, /never end on a lesson/u);
    });

    /**
     * The collision device, as a test. Two sections handed the same sign-up answer write
     * the same observation twice — that was the original complaint about this profile, and
     * `careerStage` landed in two briefs at once while this was being rewritten.
     */
    it("gives each sign-up answer to exactly one section", () => {
        const briefs = buildPrompt(input).split("SECTIONS")[1].split("OUTPUT")[0];

        for (const fact of ["do my research", "changing field", "in a relationship", "career, self development"]) {
            const hits = briefs.split(fact).length - 1;

            assert.equal(hits, 1, `"${fact}" appears ${hits}× in the section briefs, expected once`);
        }
    });

    /**
     * The briefs must never ask for an action. Checked on the section briefs alone: the
     * interpolated voice rules legitimately say "today" while banning it, and the ban
     * block quotes the banned words to ban them.
     */
    it("never briefs a section to hand out advice", () => {
        const briefs = buildPrompt(input).split("SECTIONS")[1].split("HOW TO WRITE IT")[0];

        for (const daily of [/\btoday\b/iu, /\bthis week\b/iu, /\bright now\b/iu, /act on/iu]) {
            assert.doesNotMatch(briefs, daily, `section briefs must not ask for ${daily.source}`);
        }
    });
});
