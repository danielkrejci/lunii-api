import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NatalAspect } from "./aspects";
import { toPointPosition } from "./ephemeris";
import { dominantElement, dominantModality, selectKeyPlanets } from "./temperament";
import { NatalChart, Planet, PLANETS } from "./types";

/** Longitude at the middle of a sign, by index: 0 aries … 11 pisces. */
const sign = (index: number) => index * 30 + 15;

/** Every planet parked in Aries unless placed elsewhere. */
function chartOf(placements: Partial<Record<Planet | "ascendant", number>>): NatalChart {
    const chart = {} as NatalChart;

    for (const planet of PLANETS) {
        chart[planet] = toPointPosition(placements[planet] ?? sign(0));
    }

    if (placements.ascendant !== undefined) {
        chart.ascendant = toPointPosition(placements.ascendant);
    }

    return chart;
}

const aspect = (a: string, b: string, strength: number) => ({ a, b, strength }) as unknown as NatalAspect;

describe("dominantElement", () => {
    it("weighs the Sun, Moon and Ascendant above the rest", () => {
        // Sun, Moon, Ascendant in water (9); Mercury, Venus, Mars in earth (6).
        const chart = chartOf({
            sun: sign(3),
            moon: sign(7),
            ascendant: sign(11),
            mercury: sign(1),
            venus: sign(5),
            mars: sign(9),
            jupiter: sign(2),
            saturn: sign(6),
        });

        const balance = dominantElement(chart);

        assert.equal(balance.key, "water");
        assert.deepEqual(balance.distribution, {
            fire: 0,
            earth: 6,
            air: 2,
            water: 9,
        });
    });

    it("never counts the outer planets", () => {
        const base = chartOf({
            sun: sign(1),
            moon: sign(1),
            uranus: sign(0),
            neptune: sign(0),
            pluto: sign(0),
        });
        const moved = chartOf({
            sun: sign(1),
            moon: sign(1),
            uranus: sign(3),
            neptune: sign(3),
            pluto: sign(3),
        });

        assert.deepEqual(dominantElement(base), dominantElement(moved));
    });

    it("leaves the Ascendant out when there is no birth time", () => {
        const balance = dominantElement(chartOf({}));

        // Every planet in Aries, and the outer three count for nothing: 3+3+2+2+2+1+1.
        assert.equal(balance.distribution.fire, 14);
        assert.equal(balance.key, "fire");
    });

    it("breaks a tie in favour of the Sun's element", () => {
        // Sun (3) + Jupiter (1) in air against Moon (3) + Saturn (1) in water, the rest
        // split so fire and earth stay below.
        const chart = chartOf({
            sun: sign(2),
            jupiter: sign(6),
            moon: sign(3),
            saturn: sign(7),
            mercury: sign(0),
            venus: sign(1),
            mars: sign(4),
        });

        const balance = dominantElement(chart);

        assert.equal(balance.distribution.air, balance.distribution.water);
        assert.equal(balance.key, "air");
    });
});

describe("dominantModality", () => {
    it("counts signs by modality", () => {
        // Sun Taurus, Moon Leo, Ascendant Scorpio — all fixed.
        const balance = dominantModality(chartOf({ sun: sign(1), moon: sign(4), ascendant: sign(7) }));

        assert.equal(balance.key, "fixed");
        assert.equal(balance.distribution.fixed, 9);
    });
});

describe("selectKeyPlanets", () => {
    it("returns three planets and never a luminary or an outer planet", () => {
        const picked = selectKeyPlanets(chartOf({ sun: sign(4) }), []);

        assert.equal(picked.length, 3);

        for (const { planet } of picked) {
            assert.ok(["mercury", "venus", "mars", "jupiter", "saturn"].includes(planet));
        }
    });

    it("prefers a planet that aspects the Sun, Moon or Ascendant", () => {
        const chart = chartOf({
            sun: sign(4),
            mercury: sign(5),
            venus: sign(5),
            mars: sign(5),
            saturn: sign(5),
        });

        const picked = selectKeyPlanets(chart, [aspect("sun", "saturn", 1)]);

        assert.equal(picked[0].planet, "saturn");
    });

    it("pushes down a planet that only repeats the Sun's sign", () => {
        // Sun and Mercury in Leo, where Mercury has no dignity to fall back on; Jupiter
        // and Saturn in signs that are not notable for them either.
        const chart = chartOf({
            sun: sign(4),
            mercury: sign(4),
            venus: sign(6),
            mars: sign(10),
            jupiter: sign(10),
            saturn: sign(8),
        });

        const picked = selectKeyPlanets(chart, []).map(({ planet }) => planet);

        assert.ok(!picked.includes("mercury"), `expected Mercury in the Sun's sign to drop out, got ${picked}`);
    });

    it("is deterministic regardless of aspect order", () => {
        const chart = chartOf({ sun: sign(4), moon: sign(8) });
        const aspects = [aspect("moon", "mars", 0.5), aspect("sun", "venus", 0.4), aspect("mercury", "jupiter", 0.9)];

        assert.deepEqual(
            selectKeyPlanets(chart, aspects),
            selectKeyPlanets(chart, [aspects[2], aspects[1], aspects[0]])
        );
    });

    it("reports retrograde from the chart", () => {
        const chart = chartOf({ sun: sign(4) });
        chart.mercury = toPointPosition(sign(6), -0.5);

        const mercury = selectKeyPlanets(chart, [aspect("sun", "mercury", 1)]).find(
            ({ planet }) => planet === "mercury"
        );

        assert.equal(mercury?.retrograde, true);
    });
});
