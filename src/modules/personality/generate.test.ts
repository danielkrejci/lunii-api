import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NatalAspect, NatalChart } from "../astro";
import { buildAnswerSchema, buildOverview, buildPrompt, computeProfileFacts, ProfileFacts } from "./generate";
import { personalityOverviewSchema } from "./schema";

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
    ascendant: { sign: "leo", longitude: 130 },
} as unknown as NatalChart;

const chartWithoutTime = { ...chart, ascendant: undefined };

const aspects = [
    { a: "sun", b: "saturn", aspect: "square", group: "challenging", orb: 1.2, strength: 0.8 },
] as unknown as NatalAspect[];

const facts = computeProfileFacts({ chart, aspects, sunSign: "gemini" });
const factsWithoutTime = computeProfileFacts({
    chart: chartWithoutTime as NatalChart,
    aspects,
    sunSign: "gemini",
});

const input = {
    chart,
    aspects,
    facts,
    relationshipStatus: "in_a_relationship",
    careerStage: "changing_field",
    decisionStyle: "do_my_research",
    areasOfInterest: ["career", "self_development"],
    contentPreference: "practical",
    beliefLevel: "curious_sceptic",
    language: "Respond in Czech.",
};

const part = (prompt: string, from: string, to: string) => prompt.split(from)[1].split(to)[0];

describe("computeProfileFacts", () => {
    it("takes the signs from the chart and the Sun from what the reader confirmed", () => {
        assert.equal(facts.sunSign, "gemini");
        assert.equal(facts.moonSign, "aquarius");
        assert.equal(facts.risingSign, "leo");
        assert.equal(facts.keyPlanets.length, 3);
    });

    it("has no Rising sign without a birth time", () => {
        assert.equal(factsWithoutTime.risingSign, null);
    });
});

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

        for (const raw of ["do_my_research", "changing_field", "in_a_relationship", "self_development"]) {
            assert.doesNotMatch(prompt, new RegExp(raw, "u"));
        }
    });

    it("hands the computed facts over as given", () => {
        const prompt = buildPrompt(input);

        assert.match(prompt, new RegExp(`Dominant element: ${facts.element.key}`, "u"));
        assert.match(prompt, new RegExp(`Dominant modality: ${facts.modality.key}`, "u"));
        assert.match(prompt, /Never contradict them\nand never recount them/u);

        for (const { planet, sign } of facts.keyPlanets) {
            assert.match(prompt, new RegExp(`${planet} in ${sign}`, "u"));
        }
    });

    it("asks for the context first and the signature last", () => {
        const prompt = buildPrompt(input);

        const context = prompt.indexOf("PART 1 — context");
        const overview = prompt.indexOf("PART 2 — overview");
        const signature = prompt.indexOf("PART 3 — signature");

        assert.ok(context > 0 && context < overview && overview < signature);
    });

    /**
     * No birth time means no Ascendant, so the card must be impossible rather than merely
     * discouraged — and the reader is never told it is missing.
     */
    it("drops the Rising card entirely when there is no birth time", () => {
        const prompt = buildPrompt({ ...input, chart: chartWithoutTime as NatalChart, facts: factsWithoutTime });

        assert.doesNotMatch(part(prompt, "PART 2", "PART 3"), /- rising/u);
        assert.match(prompt, /unknown — no birth time was given/u);
    });

    it("briefs the Rising card when there is a birth time", () => {
        assert.match(part(buildPrompt(input), "PART 2", "PART 3"), /- rising — their Rising sign, leo/u);
    });

    /**
     * The context is read by prompts that may not name the astrology, and whatever sits in
     * a prompt's context gets echoed.
     */
    it("keeps the astrology vocabulary out of the context", () => {
        const brief = part(buildPrompt(input), "PART 1", "PART 2");

        assert.match(brief, /NO astrology\n {2}vocabulary at all/u);
        assert.match(brief, /Leave a category empty rather than invent something/u);
    });

    /**
     * The cards are about the chart; the sign-up answers belong to the signature and the
     * context, where they make the text about this person rather than about the sign.
     */
    it("gives the sign-up answers to the signature, never to a card", () => {
        const prompt = buildPrompt(input);
        const cards = part(prompt, "PART 2", "PART 3");

        assert.match(cards, /no fact from their sign-up answers belongs on a card/u);
        assert.match(part(prompt, "PART 3", "OUTPUT"), /This is where their sign-up answers come in, unnamed/u);

        for (const fact of ["do my research", "changing field", "in a relationship"]) {
            assert.doesNotMatch(cards, new RegExp(fact, "u"));
        }
    });

    it("forbids the signature from repeating the cards", () => {
        const signature = part(buildPrompt(input), "PART 3", "OUTPUT");

        assert.match(signature, /It must say something none of the cards said/u);
        assert.match(signature, /never "You are a woman who…"/u);
    });

    /**
     * The signature is the long read now: one text in paragraphs, no title, and each
     * paragraph briefed with its own job so the second does not restate the first.
     */
    it("asks for the signature as two or three paragraphs and no title", () => {
        const signature = part(buildPrompt(input), "PART 3", "OUTPUT");

        assert.match(signature, /two or three paragraphs, two to four sentences each/u);
        assert.match(signature, /One paragraph per array entry/u);
        assert.doesNotMatch(signature, /- title:/u);
    });

    it("lifts the ban on naming the astrology on the cards only", () => {
        const prompt = buildPrompt(input);

        assert.match(prompt, /NAME THE ASTROLOGY ON THE CARDS — THIS IS THE EXCEPTION/u);
        assert.match(prompt, /In part 1 the ban stands in full/u);
    });

    /**
     * A real generation called a square a conjunction — a factual claim about this
     * person's chart that any reader who knows charts will catch.
     */
    it("forbids naming the aspect it could get wrong", () => {
        const prompt = buildPrompt(input);

        assert.match(prompt, /NAME THE PLANETS, NEVER THE ANGLE BETWEEN THEM/u);
        assert.match(prompt, /because of the influences in your chart/u);
    });

    it("says there is no standing aspect rather than leaving the list empty", () => {
        assert.match(buildPrompt({ ...input, aspects: [] }), /no close aspect to itself/u);
    });

    it("asks for a person rather than a day", () => {
        const prompt = buildPrompt(input);

        assert.match(prompt, /A PERSON, NOT A DAY/u);
        assert.match(prompt, /There is no today here\./u);
        assert.match(prompt, /This is analysis, not advice\./u);
    });

    /**
     * Checked on the part briefs alone: the interpolated voice rules legitimately say
     * "today" while banning it.
     */
    it("never briefs a part to be about a day", () => {
        const briefs = part(buildPrompt(input), "PART 1", "HOW TO WRITE IT");

        for (const daily of [/\btoday\b/iu, /\bthis week\b/iu, /\bright now\b/iu]) {
            assert.doesNotMatch(briefs, daily, `part briefs must not ask for ${daily.source}`);
        }
    });
});

/** A well-formed answer for these facts, for the schema tests to break. */
const answer = (shape: ProfileFacts) => ({
    context: {
        corePatterns: [{ text: "Decides slowly.", points: ["sun", "saturn"] }],
        innerTensions: [],
        emotionalPatterns: [],
        relationshipPatterns: [],
        workPatterns: [],
    },
    overview: {
        sun: { keyword: "Curious", text: "You collect ideas." },
        moon: { keyword: "Detached", text: "You feel it later." },
        ...(shape.risingSign ? { rising: { keyword: "Warm", text: "Rooms like you." } } : {}),
        element: { text: "You think first." },
        modality: { text: "You adapt." },
        planets: Object.fromEntries(shape.keyPlanets.map(({ planet }) => [planet, { text: "Something." }])),
    },
    signature: { summary: ["How it fits together.", "Where it shows."] },
});

describe("buildAnswerSchema", () => {
    it("accepts an answer keyed by exactly the selected planets", () => {
        assert.ok(buildAnswerSchema(facts).safeParse(answer(facts)).success);
    });

    it("has no Rising card and no Ascendant point without a birth time", () => {
        const schema = buildAnswerSchema(factsWithoutTime);
        const withAscendant = answer(factsWithoutTime);
        withAscendant.context.corePatterns[0].points = ["ascendant"];

        assert.ok(schema.safeParse(answer(factsWithoutTime)).success);
        assert.ok(!schema.safeParse(withAscendant).success);
    });

    it("rejects an answer missing one of the selected planets", () => {
        const broken = answer(facts);
        delete broken.overview.planets[facts.keyPlanets[0].planet];

        assert.ok(!buildAnswerSchema(facts).safeParse(broken).success);
    });
});

describe("buildOverview", () => {
    it("keeps every fact when the model failed", () => {
        const overview = buildOverview(facts, null);

        assert.ok(personalityOverviewSchema.safeParse(overview).success);
        assert.equal(overview.sun.sign, "gemini");
        assert.equal(overview.rising?.sign, "leo");
        assert.equal(overview.keyPlanets.length, 3);
        assert.equal(overview.sun.text, "");
        assert.deepEqual(overview.signature.summary, []);
    });

    it("stores a null Rising card without a birth time", () => {
        assert.equal(buildOverview(factsWithoutTime, null).rising, null);
    });
});
