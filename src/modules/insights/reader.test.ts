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

const reader: Reader = {
    gender: "female",
    decisionStyle: "do_my_research",
    careerStage: "changing_field",
    relationshipStatus: "in_a_relationship",
    areasOfInterest: ["career", "self_development"],
    beliefLevel: "curious_sceptic",
    contentPreference: "practical",
    personalityProfile: JSON.stringify({
        yourSign: ["Your Sun is in Gemini.", "So you think out loud."],
        yourAscendant: ["Your Ascendant is Leo.", "People meet the confident one first."],
        inYourLife: ["Decides slowly.", "Wants certainty before moving."],
    }),
    birthChart: chart,
};

const contact = (natal: string): PlanetContact =>
    ({ natal, transit: "saturn", aspect: "square" }) as unknown as PlanetContact;

describe("buildReaderBlock", () => {
    it("humanizes the enum keys the client sends", () => {
        const block = buildReaderBlock(reader);

        assert.match(block, /Decides by: do my research/u);
        assert.match(block, /Relationship: in a relationship/u);
        assert.match(block, /career, self development/u);
        // The underscored form must never survive into a prompt.
        assert.doesNotMatch(block, /_/u);
    });

    it("omits a fact rather than writing none or unknown", () => {
        const block = buildReaderBlock({
            ...reader,
            careerStage: "",
            areasOfInterest: [],
        });

        assert.doesNotMatch(block, /none|unknown/iu);
        assert.doesNotMatch(block, /Career right now/u);
        assert.doesNotMatch(block, /Cares about/u);
        // What is left is still there.
        assert.match(block, /Decides by: do my research/u);
    });

    it("carries the onboarding profile and forbids quoting it back", () => {
        const block = buildReaderBlock(reader);

        assert.match(block, /Decides slowly\./u);
        assert.match(block, /Wants certainty before moving\./u);
        assert.match(block, /Never quote or restate the profile/u);
    });

    /**
     * The two opening sections are sign-level and half of one explains what an Ascendant
     * is — general where this block needs particular, and full of vocabulary every prompt
     * reading it forbids in its own output.
     */
    it("leaves out the sections written about a placement", () => {
        const block = buildReaderBlock(reader);

        assert.doesNotMatch(block, /Gemini/u);
        assert.doesNotMatch(block, /Ascendant is Leo/u);
        // And it warns the model off the vocabulary the profile is allowed to use.
        assert.match(block, /That vocabulary belongs to it, not to you/u);
    });

    // Paragraphs stay paragraphs: joined with a space, four of them are a wall of text.
    it("keeps one paragraph per entry", () => {
        const block = buildReaderBlock(reader);

        assert.match(block, /Decides slowly\.\n\nWants certainty before moving\./u);
    });

    /**
     * A reader with no birth time has no Ascendant and so gets a two-section profile. The
     * block must not care.
     */
    it("reads a profile written without an Ascendant section", () => {
        const block = buildReaderBlock({
            ...reader,
            personalityProfile: JSON.stringify({
                yourSign: ["Your Sun is in Gemini."],
                inYourLife: ["Decides slowly."],
            }),
        });

        assert.match(block, /How they work/u);
        assert.match(block, /Decides slowly\./u);
    });

    it("drops the profile block when onboarding stored nothing usable", () => {
        const empty = JSON.stringify({ yourSign: [], yourAscendant: [], inYourLife: [] });

        for (const stored of [empty, "", "not json at all"]) {
            const block = buildReaderBlock({ ...reader, personalityProfile: stored });

            assert.doesNotMatch(block, /How they work/u, `expected no profile block for ${stored.slice(0, 20)}`);
            assert.match(block, /Decides by/u);
        }
    });

    /**
     * The column round-trips through the client as an unvalidated string, so anything at
     * all can be in it. None of these may throw.
     */
    it("ignores a shape it does not recognise", () => {
        const stored = [
            JSON.stringify({ foo: "bar" }),
            "[]",
            "null",
            "42",
            // The section as a bare string rather than the array of paragraphs it must be.
            JSON.stringify({ yourSign: ["x"], inYourLife: "Decides slowly." }),
            JSON.stringify({ yourSign: ["x"], inYourLife: ["", "   "] }),
        ];

        for (const profile of stored) {
            const block = buildReaderBlock({ ...reader, personalityProfile: profile });

            assert.doesNotMatch(block, /How they work/u, `expected no profile block for ${profile.slice(0, 24)}`);
            assert.match(block, /Decides by/u);
        }
    });

    it("keeps the paragraphs either side of an entry that is not a string", () => {
        const block = buildReaderBlock({
            ...reader,
            personalityProfile: JSON.stringify({
                yourSign: ["x"],
                inYourLife: ["Decides slowly.", 5, "Wants certainty before moving."],
            }),
        });

        assert.match(block, /Decides slowly\.\n\nWants certainty before moving\./u);
    });

    it("names only the placements today is actually touching", () => {
        const block = buildReaderBlock(reader, [contact("moon"), contact("venus"), contact("moon")]);

        assert.match(block, /their moon in aquarius/u);
        assert.match(block, /their venus in taurus/u);
        assert.doesNotMatch(block, /their saturn/u);

        // Repeated contacts on one point must not repeat the line.
        assert.equal(block.match(/their moon in aquarius/gu)?.length, 1);
    });

    it("skips a placement the chart cannot supply", () => {
        // No birth time, so no Ascendant — naming a sign for it would be a fabrication.
        const block = buildReaderBlock(reader, [contact("ascendant")]);

        assert.doesNotMatch(block, /their ascendant/u);
    });

    it("keeps the two-fact budget and the use-never-name rule in every version", () => {
        for (const block of [buildReaderBlock(reader), buildReaderBlock({ ...reader, personalityProfile: "" })]) {
            assert.match(block, /AT MOST TWO/u);
            assert.match(block, /Use, never name/u);
        }
    });
});
