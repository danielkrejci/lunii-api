import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NatalChart, PLANETS } from "../astro";
import { buildChartBlock } from "./context";

const chart = {
    sun: { sign: "gemini", longitude: 80 },
    moon: { sign: "aquarius", longitude: 310 },
    mercury: { sign: "gemini", longitude: 75, retrograde: true },
    venus: { sign: "taurus", longitude: 45 },
    mars: { sign: "aries", longitude: 10 },
    jupiter: { sign: "cancer", longitude: 100 },
    saturn: { sign: "capricorn", longitude: 280 },
    uranus: { sign: "capricorn", longitude: 275 },
    neptune: { sign: "capricorn", longitude: 285 },
    pluto: { sign: "scorpio", longitude: 225 },
} as unknown as NatalChart;

const withAscendant = { ...chart, ascendant: { sign: "libra", longitude: 187.4 } } as unknown as NatalChart;

describe("buildChartBlock", () => {
    it("names every body in the chart", () => {
        const block = buildChartBlock(chart);

        for (const planet of PLANETS) {
            assert.ok(block.includes(`- ${planet} in `), `${planet} is missing`);
        }
    });

    it("keeps the bodies in a fixed order, not the order the JSONB came back in", () => {
        // Alphabetical, which is a different order from PLANETS — as JSONB may well be.
        const shuffled = Object.fromEntries(
            Object.entries(chart).sort(([left], [right]) => left.localeCompare(right))
        ) as unknown as NatalChart;

        assert.equal(buildChartBlock(shuffled), buildChartBlock(chart));
    });

    it("gives the degree within the sign, not the absolute longitude", () => {
        // 80° is 20° of Gemini, the third sign.
        assert.ok(buildChartBlock(chart).includes("- sun in gemini, 20°"));
    });

    it("marks a retrograde placement", () => {
        assert.ok(buildChartBlock(chart).includes("- mercury in gemini, 15°, retrograde"));
    });

    it("does not mark the bodies that are direct", () => {
        assert.ok(buildChartBlock(chart).includes("- venus in taurus, 15°\n"));
    });

    /**
     * The same rule `buildReaderBlock` keeps: an Ascendant with no birth time behind it
     * is an artefact of an assumed noon, and stating it would be a fabrication.
     */
    it("omits the Ascendant when there is no birth time, and says why", () => {
        const block = buildChartBlock(chart);

        assert.ok(!block.includes("ascendant in"));
        assert.match(block, /no birth time/u);
    });

    it("includes the Ascendant when there is one, and then says nothing about birth times", () => {
        const block = buildChartBlock(withAscendant);

        assert.ok(block.includes("- ascendant in libra, 7°"));
        assert.doesNotMatch(block, /no birth time/u);
    });

    it("tells the model the chart is reference rather than subject matter", () => {
        assert.match(buildChartBlock(chart), /do not list it back/u);
    });
});
