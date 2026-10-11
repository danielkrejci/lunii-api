import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NatalChart } from "../astro";
import { PlanetContact } from "../dailyScore/types";
import { buildReaderBlock, Reader } from "./reader";

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

const context = {
    corePatterns: [{ text: "Decides slowly.", points: ["sun", "saturn"] }],
    innerTensions: [{ text: "Wants certainty before moving.", points: ["mars", "saturn"] }],
    emotionalPatterns: [{ text: "Goes quiet when upset.", points: ["moon"] }],
    relationshipPatterns: [{ text: "Shows care by fixing things.", points: ["venus"] }],
    workPatterns: [{ text: "Stalls when the brief is vague.", points: ["mercury"] }],
};

const reader: Reader = {
    gender: "female",
    decisionStyle: "do_my_research",
    careerStage: "changing_field",
    relationshipStatus: "in_a_relationship",
    areasOfInterest: ["career", "self_development"],
    beliefLevel: "curious_sceptic",
    contentPreference: "practical",
    personalityContext: context,
    birthChart: chart,
};

const contact = (natal: string): PlanetContact =>
    ({ natal, transit: "saturn", aspect: "square" }) as unknown as PlanetContact;

describe("buildReaderBlock", () => {
    it("humanizes the enum keys the client sends", () => {
        const block = buildReaderBlock(reader, "daily");

        assert.match(block, /Decides by: do my research/u);
        assert.match(block, /Relationship: in a relationship/u);
        assert.match(block, /career, self development/u);
        // The underscored form must never survive into a prompt.
        assert.doesNotMatch(block, /_/u);
    });

    it("omits a fact rather than writing none or unknown", () => {
        const block = buildReaderBlock({ ...reader, careerStage: "", areasOfInterest: [] }, "daily");

        assert.doesNotMatch(block, /none|unknown/iu);
        assert.doesNotMatch(block, /Career right now/u);
        assert.doesNotMatch(block, /Cares about/u);
        assert.match(block, /Decides by: do my research/u);
    });

    it("carries the context and forbids quoting it back", () => {
        const block = buildReaderBlock(reader, "daily");

        assert.match(block, /- Decides slowly\./u);
        assert.match(block, /- Wants certainty before moving\./u);
        assert.match(block, /Never quote or restate how they work/u);
    });

    /**
     * Each prompt takes the part of the context that bears on its question, not all of it.
     */
    it("carries only the categories its focus asks for", () => {
        const daily = buildReaderBlock(reader, "daily");
        assert.doesNotMatch(daily, /Shows care by fixing things/u);
        assert.doesNotMatch(daily, /Goes quiet when upset/u);

        const compatibility = buildReaderBlock(reader, "compatibility");
        assert.match(compatibility, /Shows care by fixing things/u);
        assert.match(compatibility, /Wants certainty before moving/u);
        assert.doesNotMatch(compatibility, /Stalls when the brief is vague/u);

        const moon = buildReaderBlock(reader, "moon");
        assert.match(moon, /Goes quiet when upset/u);
        assert.doesNotMatch(moon, /Decides slowly/u);
    });

    it("pulls in an observation about a point today is touching, from any category", () => {
        const block = buildReaderBlock(reader, "daily", [contact("venus")]);

        assert.match(block, /Shows care by fixing things/u);
        // Most relevant first.
        assert.ok(block.indexOf("Shows care") < block.indexOf("Decides slowly"));
    });

    it("never repeats an observation that qualifies twice", () => {
        const block = buildReaderBlock(reader, "daily", [contact("saturn")]);

        assert.equal(block.match(/Decides slowly/gu)?.length, 1);
    });

    it("caps how many observations a block carries", () => {
        const many = Array.from({ length: 3 }, (_, index) => ({ text: `Pattern ${index}.`, points: ["sun"] }));
        const full = Object.fromEntries(
            ["corePatterns", "innerTensions", "emotionalPatterns", "relationshipPatterns", "workPatterns"].map(
                (category) => [category, many.map((item) => ({ ...item, text: `${category} ${item.text}` }))]
            )
        );

        const block = buildReaderBlock({ ...reader, personalityContext: full }, "chat");

        assert.equal(block.match(/^- /gmu)?.length, 8);
    });

    /**
     * The column is JSONB written by a generation that may have failed, and at onboarding
     * it came through the client. None of these may throw or produce a block.
     */
    it("drops the context block when there is nothing usable", () => {
        const stored = [
            null,
            undefined,
            "",
            "not json at all",
            { foo: "bar" },
            [],
            42,
            { ...context, corePatterns: "Decides slowly." },
            Object.fromEntries(Object.keys(context).map((key) => [key, []])),
        ];

        for (const personalityContext of stored) {
            const block = buildReaderBlock({ ...reader, personalityContext }, "daily");

            assert.doesNotMatch(block, /How they work/u, `expected no block for ${JSON.stringify(personalityContext)}`);
            assert.match(block, /Decides by/u);
        }
    });

    it("names only the placements today is actually touching", () => {
        const block = buildReaderBlock(reader, "daily", [contact("moon"), contact("venus"), contact("moon")]);

        assert.match(block, /their moon in aquarius/u);
        assert.match(block, /their venus in taurus/u);
        assert.doesNotMatch(block, /their saturn/u);

        // Repeated contacts on one point must not repeat the line.
        assert.equal(block.match(/their moon in aquarius/gu)?.length, 1);
    });

    it("skips a placement the chart cannot supply", () => {
        // No birth time, so no Ascendant — naming a sign for it would be a fabrication.
        const block = buildReaderBlock(reader, "daily", [contact("ascendant")]);

        assert.doesNotMatch(block, /their ascendant/u);
    });

    it("keeps the two-fact budget and the use-never-name rule in every version", () => {
        for (const block of [
            buildReaderBlock(reader, "daily"),
            buildReaderBlock({ ...reader, personalityContext: null }, "chat"),
        ]) {
            assert.match(block, /AT MOST TWO/u);
            assert.match(block, /Use, never name/u);
        }
    });
});
