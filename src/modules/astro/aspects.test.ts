import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findNatalAspects } from "./aspects";
import { toPointPosition } from "./ephemeris";
import { NatalChart, Planet, PLANETS } from "./types";

/**
 * A chart with every body parked far from every other, so a test only has to place the
 * two or three points it actually cares about. 200° apart in a 360° circle is outside
 * every orb in MAX_ORBS.
 */
function chartOf(placements: Partial<Record<Planet | "ascendant", number>>): NatalChart {
    const chart = {} as NatalChart;

    PLANETS.forEach((planet, index) => {
        chart[planet] = toPointPosition(placements[planet] ?? index * 0.7 + 200);
    });

    if (placements.ascendant !== undefined) {
        chart.ascendant = toPointPosition(placements.ascendant);
    }

    return chart;
}

describe("findNatalAspects", () => {
    it("finds an exact square and names the pair in NATAL_POINTS order", () => {
        const found = findNatalAspects(chartOf({ sun: 10, saturn: 100 }));

        const square = found.find((aspect) => aspect.aspect === "square");

        assert.ok(square, "expected a square between Sun and Saturn");
        assert.equal(square.a, "sun");
        assert.equal(square.b, "saturn");
        assert.equal(square.group, "challenging");
        assert.equal(square.orb, 0);
        assert.equal(square.strength, 1);
    });

    it("reports each unordered pair once rather than as itself and its mirror", () => {
        const found = findNatalAspects(chartOf({ sun: 10, moon: 130 }));

        const between = found.filter(
            (aspect) => (aspect.a === "sun" && aspect.b === "moon") || (aspect.a === "moon" && aspect.b === "sun")
        );

        assert.equal(between.length, 1);
    });

    it("sorts the tightest aspect first", () => {
        // Sun trine Saturn is 2° off; Sun square Mars is exact.
        const found = findNatalAspects(chartOf({ sun: 10, saturn: 132, mars: 100 }));

        assert.ok(found.length >= 2);
        assert.deepEqual(
            [...found].sort((x, y) => y.strength - x.strength).map((a) => a.orb),
            found.map((a) => a.orb)
        );
    });

    it("skips the Ascendant when there is no birth time to place it", () => {
        const withoutTime = findNatalAspects(chartOf({ sun: 10 }));

        assert.equal(
            withoutTime.some((aspect) => aspect.a === "ascendant" || aspect.b === "ascendant"),
            false
        );

        const withTime = findNatalAspects(chartOf({ sun: 10, ascendant: 10 }));

        assert.ok(withTime.some((aspect) => aspect.b === "ascendant"));
    });

    it("drops aspects a whole birth cohort shares when personalOnly is set", () => {
        // Neptune sextile Pluto: true of everyone born within years of this chart.
        const chart = chartOf({ neptune: 10, pluto: 70, venus: 190 });

        const everything = findNatalAspects(chart);
        const personal = findNatalAspects(chart, { personalOnly: true });

        assert.ok(
            everything.some((aspect) => aspect.a === "neptune" && aspect.b === "pluto"),
            "the geometry itself must still report it"
        );
        assert.equal(
            personal.some((aspect) => aspect.a === "neptune" && aspect.b === "pluto"),
            false
        );
        assert.ok(
            personal.some((aspect) => aspect.a === "venus"),
            "an aspect with a personal endpoint survives"
        );
    });
});
