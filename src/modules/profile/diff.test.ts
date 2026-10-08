import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { profile as profileTable } from "../../db/schema";
import { diffProfile } from "./diff";

const stored = {
    name: "Anna",
    gender: "female",
    birthDate: "1990-05-20",
    birthTime: "14:30:00",
    birthPlace: "Praha",
    birthPlaceLat: 50.08,
    birthPlaceLng: 14.42,
    country: "Czechia",
    language: "cs",
    relationshipStatus: "single",
    careerStage: "working",
    decisionStyle: "by_instinct",
    areasOfInterest: ["love", "career"],
    contentPreference: "practical_advice",
    beliefLevel: "open_to_it",
} as unknown as typeof profileTable.$inferSelect;

describe("diffProfile", () => {
    it("drops fields sent with the value they already have", () => {
        const { changed, scope } = diffProfile(stored, { name: "Anna", language: "cs" });

        assert.deepEqual(changed, {});
        assert.equal(scope, "none");
    });

    it("compares the birth time without the seconds the column stores", () => {
        assert.equal(diffProfile(stored, { birthTime: "14:30" }).scope, "none");
        assert.equal(diffProfile(stored, { birthTime: "14:31" }).scope, "chart");
    });

    it("treats an unknown birth time as a change of chart", () => {
        assert.deepEqual(diffProfile(stored, { birthTime: null }), { changed: { birthTime: null }, scope: "chart" });
    });

    it("reads the areas of interest as a set", () => {
        assert.equal(diffProfile(stored, { areasOfInterest: ["career", "love"] }).scope, "none");
        assert.equal(diffProfile(stored, { areasOfInterest: ["career"] }).scope, "wording");
    });

    it("lets a new chart win over new wording", () => {
        assert.equal(diffProfile(stored, { language: "en", birthDate: "1991-05-20" }).scope, "chart");
    });

    it("rewrites the wording for language, gender and the onboarding answers", () => {
        for (const requested of [
            { language: "en" },
            { gender: "male" as const },
            { relationshipStatus: "married" },
            { beliefLevel: "just_for_fun" },
        ]) {
            assert.equal(diffProfile(stored, requested).scope, "wording");
        }
    });

    it("rewrites nothing for the name, the country or a renamed place", () => {
        const { changed, scope } = diffProfile(stored, {
            name: "Anička",
            birthPlace: "Prague",
            birthPlaceLat: 50.08,
            birthPlaceLng: 14.42,
            country: "Czech Republic",
        });

        assert.deepEqual(changed, { name: "Anička", birthPlace: "Prague", country: "Czech Republic" });
        assert.equal(scope, "none");
    });

    it("moves the chart when the coordinates move", () => {
        assert.equal(diffProfile(stored, { birthPlaceLat: 49.19, birthPlaceLng: 16.6 }).scope, "chart");
    });
});
