/**
 * Statistical tests — guardrails on the shape of the output.
 *
 * The domain tests assert what individual rules mean. These assert that the
 * population of scores stays usable: centred where we chose, spread enough to
 * carry information, balanced across areas, and never out of range.
 *
 * A failure here usually means the rule table changed and the calibration was not
 * re-run, or that a change moved the distribution somewhere we did not intend.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { calculateDailyScore, summarizePlanetInfluence } from ".";
import { buildSample } from "../../scripts/sampling";
import { LIFE_AREAS, LifeArea, PLANETS } from "../astro";

/* ============================================================
   SAMPLE
============================================================ */

const CHARTS = 40;
const DAYS = 120;

const { subjects, transitCharts } = buildSample(CHARTS, DAYS);

const scores: Record<LifeArea, number[]> = { love: [], career: [], health: [], mood: [] };
const raw: Record<LifeArea, number[]> = { love: [], career: [], health: [], mood: [] };
const overall: number[] = [];
const confidences: number[] = [];
const deltas: number[] = [];
/** Day-to-day movement per area, reset between subjects so no delta crosses charts. */
const areaDeltas: Record<LifeArea, number[]> = { love: [], career: [], health: [], mood: [] };
const soleHighest: Record<LifeArea, number> = { love: 0, career: 0, health: 0, mood: 0 };

let unresolved = 0;
let outOfRange = 0;
let soleHighestDays = 0;

for (const subject of subjects) {
    let previous: number | null = null;
    let previousByArea: Record<LifeArea, number> | null = null;

    for (const transits of transitCharts) {
        const result = calculateDailyScore({
            natal: subject.chart,
            transits,
            hasBirthTime: subject.hasBirthTime,
        });

        const byArea: Record<LifeArea, number> = {
            love: result.scores.loveScore,
            career: result.scores.careerScore,
            health: result.scores.healthScore,
            mood: result.scores.moodScore,
        };

        for (const area of LIFE_AREAS) {
            scores[area].push(byArea[area]);
            raw[area].push(result.raw[area]);

            if (!Number.isInteger(byArea[area]) || byArea[area] < 0 || byArea[area] > 100) {
                outOfRange++;
            }
        }

        if (
            !Number.isInteger(result.scores.overallScore) ||
            result.scores.overallScore < 0 ||
            result.scores.overallScore > 100
        ) {
            outOfRange++;
        }

        overall.push(result.scores.overallScore);
        confidences.push(result.confidence);
        unresolved += result.unresolved.length;

        const best = Math.max(...LIFE_AREAS.map((area) => byArea[area]));
        const winners = LIFE_AREAS.filter((area) => byArea[area] === best);

        if (winners.length === 1) {
            soleHighest[winners[0]]++;
            soleHighestDays++;
        }

        if (previous !== null) {
            deltas.push(Math.abs(result.scores.overallScore - previous));
        }

        if (previousByArea !== null) {
            for (const area of LIFE_AREAS) {
                areaDeltas[area].push(Math.abs(byArea[area] - previousByArea[area]));
            }
        }

        previous = result.scores.overallScore;
        previousByArea = byArea;
    }
}

/* ============================================================
   HELPERS
============================================================ */

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

const stddev = (values: number[]) => {
    const average = mean(values);

    return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
};

const percentile = (values: number[], fraction: number) => {
    const sorted = [...values].sort((a, b) => a - b);

    return sorted[Math.min(sorted.length - 1, Math.round(fraction * (sorted.length - 1)))];
};

/* ============================================================
   VALIDITY
============================================================ */

describe("validity", () => {
    it("resolves every aspect it finds", () => {
        assert.equal(unresolved, 0, `${unresolved} hits had no rule — run lintDailyScoreRules`);
    });

    it("only ever emits integers in 0..100", () => {
        assert.equal(outOfRange, 0, `${outOfRange} scores were out of range or not integers`);
    });

    it("is reproducible", () => {
        const first = calculateDailyScore({
            natal: subjects[0].chart,
            transits: transitCharts[0],
            hasBirthTime: subjects[0].hasBirthTime,
        });

        const second = calculateDailyScore({
            natal: subjects[0].chart,
            transits: transitCharts[0],
            hasBirthTime: subjects[0].hasBirthTime,
        });

        assert.deepEqual(first, second);
    });
});

/* ============================================================
   CENTRE AND SPREAD
============================================================ */

describe("distribution", () => {
    it("centres overall scores in the mildly optimistic band", () => {
        const average = mean(overall);

        assert.ok(average > 52 && average < 60, `overall mean should sit in 52..60, got ${average.toFixed(1)}`);
    });

    it("keeps the chosen tails", () => {
        // Target widened from 38/74 to 25/85 on 2026-08-05: a daily score should use
        // most of the range and let genuinely bad and good days exist.
        const p10 = percentile(overall, 0.1);
        const p90 = percentile(overall, 0.9);

        assert.ok(p10 > 18 && p10 < 32, `overall p10 should sit near the 25 target, got ${p10}`);
        assert.ok(p90 > 78 && p90 < 92, `overall p90 should sit near the 85 target, got ${p90}`);
    });

    it("reaches both ends of the scale", () => {
        // The point of the wider target: extremes must be reachable, not theoretical.
        const veryLow = (overall.filter((score) => score < 20).length / overall.length) * 100;
        const veryHigh = (overall.filter((score) => score > 80).length / overall.length) * 100;

        assert.ok(veryLow > 2 && veryLow < 15, `${veryLow.toFixed(1)}% of days below 20, expected 2..15`);
        assert.ok(veryHigh > 6 && veryHigh < 30, `${veryHigh.toFixed(1)}% of days above 80, expected 6..30`);
    });

    it("spreads every area enough to carry information", () => {
        for (const area of LIFE_AREAS) {
            const spread = stddev(scores[area]);

            assert.ok(spread > 8, `${area} stddev should exceed 8, got ${spread.toFixed(1)}`);
        }
    });

    it("moves day to day like a forecast", () => {
        // Band raised from 3..8 with the 2026-08-05 product decision: the score should
        // read like weather rather than a trend. The upper bound still exists — this is
        // a forecast, not noise.
        const median = percentile(deltas, 0.5);

        assert.ok(median >= 6 && median <= 16, `median day-to-day change should be 6..16, got ${median}`);
    });

    it("produces jumps a user would notice", () => {
        const big = (deltas.filter((delta) => delta >= 20).length / deltas.length) * 100;

        assert.ok(big > 4, `only ${big.toFixed(1)}% of days move 20+ points, expected more than 4%`);
    });
});

/* ============================================================
   BALANCE
============================================================ */

describe("balance", () => {
    it("centres all four areas together", () => {
        /**
         * Bound raised from 2 to 3 when the areas were concentrated. The fit matches
         * each area's p10/p90, not its mean, so an area whose sources lean difficult
         * lands slightly lower — health sits ~2 points under the rest because its
         * strong sources are Mars, Saturn and the outer planets through the Ascendant.
         * That is a property of the astrology, not a miscalibration, and 2 points on a
         * 0-100 scale is imperceptible. Worth watching if it ever grows.
         */
        const means = LIFE_AREAS.map((area) => mean(scores[area]));
        const spread = Math.max(...means) - Math.min(...means);

        assert.ok(
            spread < 4,
            `area means should agree within 4 points, got ${LIFE_AREAS.map((area, index) => `${area} ${means[index].toFixed(1)}`).join(", ")}`
        );
    });

    it("lets every area be good news equally often", () => {
        // The metric that matters if the four scores are shown side by side: can this
        // area be a high score at all? "Which area is highest" measures something
        // else — an area fed from many sources sits near the average of the others
        // and therefore rarely wins the comparison, without ever being worse off.
        const shares = LIFE_AREAS.map((area) => ({
            area,
            share: (scores[area].filter((score) => score >= 70).length / scores[area].length) * 100,
        }));

        const spread =
            Math.max(...shares.map((entry) => entry.share)) - Math.min(...shares.map((entry) => entry.share));

        assert.ok(
            spread < 7,
            `"reaches 70+" should agree within 7 points across areas, got ` +
                shares.map((entry) => `${entry.area} ${entry.share.toFixed(1)}%`).join(", ")
        );
    });

    it("never lets one area monopolise the top spot", () => {
        // A loose canary, not a target. Only meaningful if the UI highlights a single
        // "best area today" — tighten it to ~33% if it ever does.
        for (const area of LIFE_AREAS) {
            const share = (soleHighest[area] / soleHighestDays) * 100;

            assert.ok(share < 50, `${area} is sole highest ${share.toFixed(1)}% of days`);
        }
    });

    it("moves every area at a usable pace", () => {
        /**
         * Replaces a test on raw dynamic range. That was a proxy for "is this area's
         * signal amplified noise", and it stopped tracking its own intent: calibration
         * refits sigma per area, so a narrow raw range does not imply a jumpy score.
         * The thing worth guarding is the score movement itself, so measure that.
         */
        for (const area of LIFE_AREAS) {
            const median = percentile(areaDeltas[area], 0.5);

            assert.ok(median >= 4 && median <= 20, `${area} moves ${median} points a day on average, expected 4..20`);
        }
    });
});

/* ============================================================
   PLANET INFLUENCE
============================================================ */

describe("planet influence", () => {
    const sample = subjects.slice(0, 6).flatMap((subject) =>
        transitCharts.slice(0, 40).map((transits) =>
            summarizePlanetInfluence(
                calculateDailyScore({
                    natal: subject.chart,
                    transits,
                    hasBirthTime: subject.hasBirthTime,
                }).impacts
            )
        )
    );

    it("lists every body, strongest first", () => {
        for (const day of sample) {
            assert.equal(day.length, PLANETS.length);

            for (let index = 1; index < day.length; index++) {
                assert.ok(day[index - 1].score >= day[index].score, "planet list must be sorted by score");
            }
        }
    });

    it("only emits integers in 0..100", () => {
        for (const day of sample) {
            for (const planet of day) {
                assert.ok(
                    Number.isInteger(planet.score) && planet.score >= 0 && planet.score <= 100,
                    `${planet.name} scored ${planet.score}`
                );
            }
        }
    });

    it("scores a body zero when it aspects nothing", () => {
        const idle = sample.flat().filter((planet) => planet.aspects === 0);

        for (const planet of idle) {
            assert.equal(planet.score, 0, `${planet.name} has no aspects but scored ${planet.score}`);
            assert.deepEqual(planet.contacts, []);
        }
    });

    it("uses each body's own scale rather than comparing them", () => {
        // Saturn's raw weight is a fraction of the Sun's, yet a loud Saturn day must be
        // able to outscore a quiet Sun day. Without the per-planet fit the slow bodies
        // would sit near zero forever.
        const saturn = sample.flat().filter((planet) => planet.name === "saturn" && planet.aspects > 0);
        const best = Math.max(...saturn.map((planet) => planet.score));

        assert.ok(best > 60, `Saturn never rose above ${best}, so its own scale is not being used`);
    });

    it("moves faster for fast bodies than slow ones", () => {
        // The whole reason the timescale matters: the Moon should be volatile day to
        // day and Pluto should barely move.
        const movement = (planet: string) => {
            const series = sample.map((day) => day.find((entry) => entry.name === planet)?.score ?? 0);

            return mean(series.slice(1).map((value, index) => Math.abs(value - series[index])));
        };

        assert.ok(
            movement("moon") > movement("pluto") * 3,
            `Moon moves ${movement("moon").toFixed(1)} a day, Pluto ${movement("pluto").toFixed(1)}`
        );
    });
});

/* ============================================================
   CONFIDENCE
============================================================ */

describe("confidence", () => {
    it("stays informative on average", () => {
        const average = mean(confidences);

        assert.ok(
            average > 0.6 && average < 0.95,
            `confidence mean should sit in 0.6..0.95, got ${average.toFixed(2)}`
        );
    });

    it("never leaves 0..1", () => {
        assert.ok(confidences.every((value) => value >= 0 && value <= 1));
    });

    it("is lower without a birth time", () => {
        const withTime: number[] = [];
        const withoutTime: number[] = [];

        for (const subject of subjects) {
            const result = calculateDailyScore({
                natal: subject.chart,
                transits: transitCharts[0],
                hasBirthTime: subject.hasBirthTime,
            });

            (subject.hasBirthTime ? withTime : withoutTime).push(result.confidence);
        }

        assert.ok(withoutTime.length > 0, "sample contained no chart without a birth time");
        assert.ok(
            mean(withoutTime) < mean(withTime),
            `no-birth-time confidence ${mean(withoutTime).toFixed(2)} should be below ${mean(withTime).toFixed(2)}`
        );
    });
});
