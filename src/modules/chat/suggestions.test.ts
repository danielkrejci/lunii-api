import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { pickSuggestions, SuggestionInput } from "./suggestions";

const base: SuggestionInput = {
    scores: { love: 20, career: 61, health: 51, mood: 44, overall: 43 },
    dominantPlanet: "saturn",
    hasHoroscope: true,
    savedPerson: null,
};

const ids = (input: SuggestionInput) => pickSuggestions(input).map((s) => s.id);

describe("pickSuggestions", () => {
    it("offers four", () => {
        assert.equal(pickSuggestions(base).length, 4);
    });

    it("leads with the number that stands out", () => {
        const [first] = pickSuggestions(base);

        assert.equal(first.id, "lowest_area");
        assert.equal(first.params?.area, "love");
    });

    it("picks the genuinely lowest area, not a fixed one", () => {
        const [first] = pickSuggestions({
            ...base,
            scores: { love: 70, career: 12, health: 51, mood: 44, overall: 43 },
        });

        assert.equal(first.params?.area, "career");
    });

    /**
     * A chip that asks why something is low on a day when nothing is low asks about a
     * premise that is false, and answering it well means arguing with the question.
     */
    it("does not ask why something is low when nothing is", () => {
        assert.ok(
            !ids({ ...base, scores: { love: 70, career: 68, health: 80, mood: 66, overall: 71 } }).includes(
                "lowest_area"
            )
        );
    });

    it("does not offer to explain a horoscope that has not been written", () => {
        assert.ok(!ids({ ...base, hasHoroscope: false }).includes("explain_today"));
    });

    it("names a saved person only when there is one", () => {
        assert.ok(!ids(base).includes("saved_person"));

        const withPerson = pickSuggestions({ ...base, savedPerson: "Tereza", hasHoroscope: false });
        const person = withPerson.find((s) => s.id === "saved_person");

        assert.equal(person?.params?.name, "Tereza");
    });

    it("falls back to the evergreens on a day with nothing to say", () => {
        const quiet = ids({
            scores: { love: 70, career: 68, health: 80, mood: 66, overall: 71 },
            dominantPlanet: null,
            hasHoroscope: false,
            savedPerson: null,
        });

        assert.deepEqual(quiet, ["focus", "chart"]);
    });

    it("is deterministic, so the chips do not reshuffle under a thumb", () => {
        assert.deepEqual(pickSuggestions(base), pickSuggestions(base));
    });

    it("returns keys the app can translate, never sentences", () => {
        for (const suggestion of pickSuggestions({ ...base, savedPerson: "Tereza" })) {
            assert.match(suggestion.key, /^chat\.suggestions\./u);
        }
    });
});
