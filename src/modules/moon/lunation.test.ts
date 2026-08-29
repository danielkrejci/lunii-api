import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { julianDayPrecise, moonElongation, moonIllumination, nextLunation } from "./lunation";

/**
 * Bisection stops at one second, and the Moon's elongation moves at most 14.4° a day, so
 * a correct instant lands within 0.0002° of the target. An order of magnitude of slack.
 */
const ELONGATION_TOLERANCE = 0.002;

/** Real bounds of the synodic month — it is not a constant, it breathes with the orbit. */
const SYNODIC_MIN = 29.18;
const SYNODIC_MAX = 29.93;

/** Signed distance from the target, normalized — the same wrap-safe comparison the search uses. */
function offsetFrom(jd: number, target: number): number {
    const diff = moonElongation(jd) - target;

    return ((((diff + 180) % 360) + 360) % 360) - 180;
}

describe("julianDayPrecise", () => {
    it("keeps seconds that the astro module's getJulianDay truncates away", () => {
        const date = new Date(Date.UTC(2026, 7, 17, 3, 7, 42, 500));

        // 42.5s expressed in days, the exact amount getJulianDay would drop.
        const withoutSeconds = new Date(Date.UTC(2026, 7, 17, 3, 7, 0, 0));
        const lost = julianDayPrecise(date) - julianDayPrecise(withoutSeconds);

        assert.ok(Math.abs(lost - 42.5 / 86_400) < 1e-9, `expected 42.5s of difference, got ${lost * 86_400}s`);
    });

    it("agrees with the known Julian Day of the Unix epoch", () => {
        assert.equal(julianDayPrecise(new Date(0)), 2_440_587.5);
    });
});

describe("nextLunation", () => {
    it("lands on an elongation of 180° for a full moon", () => {
        const found = nextLunation(new Date(Date.UTC(2026, 0, 1)), "full");
        const offset = offsetFrom(julianDayPrecise(found), 180);

        assert.ok(Math.abs(offset) < ELONGATION_TOLERANCE, `off by ${offset}°`);
    });

    it("lands on an elongation of 0° for a new moon, across the 359°→1° wrap", () => {
        const found = nextLunation(new Date(Date.UTC(2026, 0, 1)), "new");
        const offset = offsetFrom(julianDayPrecise(found), 0);

        assert.ok(Math.abs(offset) < ELONGATION_TOLERANCE, `off by ${offset}°`);
    });

    it("never returns an instant before the one it was asked to search from", () => {
        // Deliberately walked across a whole lunation, so a start just past an event is covered.
        for (let day = 0; day < 40; day++) {
            const from = new Date(Date.UTC(2026, 2, 1) + day * 86_400_000);

            assert.ok(nextLunation(from, "full") >= from, `full moon before ${from.toISOString()}`);
            assert.ok(nextLunation(from, "new") >= from, `new moon before ${from.toISOString()}`);
        }
    });

    it("spaces consecutive full moons a real synodic month apart, over three years", () => {
        let cursor = new Date(Date.UTC(2026, 0, 1));
        let previous: Date | null = null;
        let count = 0;

        while (cursor.getUTCFullYear() < 2029) {
            const found = nextLunation(cursor, "full");

            if (previous) {
                const gap = (found.getTime() - previous.getTime()) / 86_400_000;

                assert.ok(
                    gap > SYNODIC_MIN && gap < SYNODIC_MAX,
                    `gap of ${gap.toFixed(4)} days at ${found.toISOString()}`
                );
            }

            previous = found;
            count++;

            // A second past the event, so the same one is not found again.
            cursor = new Date(found.getTime() + 1000);
        }

        // Three years of lunations — proves the loop actually ran rather than exiting early.
        assert.ok(count > 35, `only found ${count} full moons`);
    });
});

describe("moonIllumination", () => {
    it("reads 100% at the full moon and 0% at the new moon", () => {
        const full = nextLunation(new Date(Date.UTC(2026, 0, 1)), "full");
        const New = nextLunation(new Date(Date.UTC(2026, 0, 1)), "new");

        assert.equal(moonIllumination(moonElongation(julianDayPrecise(full))), 100);
        assert.equal(moonIllumination(moonElongation(julianDayPrecise(New))), 0);
    });

    it("still rounds to 100% twelve hours off the exact full moon", () => {
        // The worst case the peak-day rule can produce: local noon, half a day from exact.
        const full = nextLunation(new Date(Date.UTC(2026, 0, 1)), "full");

        for (const shift of [-12, 12]) {
            const at = julianDayPrecise(new Date(full.getTime() + shift * 3_600_000));

            assert.equal(moonIllumination(moonElongation(at)), 100, `${shift}h from exact`);
        }
    });
});
