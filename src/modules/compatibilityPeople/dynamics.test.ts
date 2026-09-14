import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";

import { computeNatalChart, computeTransitChart } from "../astro";
import { calculateCompatibility } from "./aspects";
import { scoreDay } from "./daily";
import { NatalChart, TransitChart } from "./types";

dayjs.extend(utc);

/**
 * Guards the property the engine exists for: a daily score that moves.
 *
 * These are not unit tests of the arithmetic — that is what the calibration script
 * measures over 200 pairs. They are a floor, deliberately loose enough that retuning
 * factors.ts or refitting calibration.ts does not break them, and tight enough that
 * the failure this module actually shipped with would.
 *
 * The regression being guarded: a global normaliser fitted on the pooled distribution
 * across pairs left a real couple at 42-61 over eleven days, sd 5.4, while their own
 * daily horoscope in the same app ran 15-71.
 */

/** A small deterministic cohort. Fixed birth data, not a seeded sample, so a failure is reproducible by hand. */
const BIRTHS: { date: string; time: string | null }[] = [
    { date: "1988-04-12", time: "08:30" },
    { date: "1990-09-23", time: "14:05" },
    { date: "1975-01-05", time: null },
    { date: "1979-11-17", time: "22:40" },
    { date: "1995-07-30", time: "03:15" },
    { date: "1993-02-08", time: "11:50" },
    { date: "2000-12-02", time: "17:20" },
    { date: "1998-06-19", time: null },
];

const DAYS = 365;

function chartOf(birth: { date: string; time: string | null }): NatalChart {
    return computeNatalChart({
        birthDate: birth.date,
        birthTime: birth.time,
        birthPlaceLat: 50.0755,
        birthPlaceLng: 14.4378,
        timezone: "Europe/Prague",
    }).chart as NatalChart;
}

function percentile(sorted: number[], fraction: number): number {
    return sorted[Math.min(sorted.length - 1, Math.round(fraction * (sorted.length - 1)))];
}

interface PairYear {
    scores: number[];
    sorted: number[];
    spread: number;
    deltas: number[];
    autocorrelation: number;
}

let years: PairYear[] = [];

before(() => {
    const charts = BIRTHS.map((birth) => chartOf(birth));

    // A year sampled every third day: the cheapest window that still contains twelve
    // full lunar cycles, which is what the daily layer's movement is made of.
    const start = dayjs.utc("2026-01-01");
    const transits: TransitChart[] = Array.from(
        { length: Math.floor(DAYS / 3) },
        (_, index) => computeTransitChart(start.add(index * 3, "day").toDate()) as TransitChart
    );

    years = [];

    for (let index = 0; index + 1 < charts.length; index += 2) {
        const reader = charts[index];
        const person = charts[index + 1];
        const baseOverall = calculateCompatibility(reader, person).overall;

        const scores = transits.map(
            (chart) => scoreDay({ readerChart: reader, personChart: person, baseOverall, transits: chart }).score
        );

        const sorted = [...scores].sort((a, b) => a - b);
        const deltas = scores.slice(1).map((score, day) => Math.abs(score - scores[day]));

        const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;

        let numerator = 0;
        let denominator = 0;

        for (const [day, score] of scores.entries()) {
            denominator += (score - mean) ** 2;

            if (day + 1 < scores.length) {
                numerator += (score - mean) * (scores[day + 1] - mean);
            }
        }

        years.push({
            scores,
            sorted,
            spread: percentile(sorted, 0.9) - percentile(sorted, 0.1),
            deltas,
            autocorrelation: denominator === 0 ? 1 : numerator / denominator,
        });
    }
});

describe("compatibility daily score dynamics", () => {
    it("gives every pair a year that spans a real range", () => {
        for (const [index, year] of years.entries()) {
            assert.ok(
                year.spread >= 25,
                `pair ${index}: p10-p90 spread was ${year.spread}, expected at least 25. ` +
                    `The old engine scored 19 here. Refit calibration.ts if factors.ts changed.`
            );
        }
    });

    it("centres every pair on its own normal rather than on a global midpoint", () => {
        for (const [index, year] of years.entries()) {
            const median = percentile(year.sorted, 0.5);

            assert.ok(
                median >= 40 && median <= 60,
                `pair ${index}: median day scored ${median}, expected 40-60. ` +
                    `A pair parked in the thirties or the seventies all year is the ` +
                    `pooled-normaliser bug returning.`
            );
        }
    });

    it("reaches both ends of the range across the cohort", () => {
        const all = years.flatMap((year) => year.scores);

        assert.ok(
            Math.min(...all) <= 20,
            `lowest score across the cohort was ${Math.min(...all)}, expected 20 or under`
        );
        assert.ok(
            Math.max(...all) >= 80,
            `highest score across the cohort was ${Math.max(...all)}, expected 80 or over`
        );
    });

    it("moves overnight without becoming noise", () => {
        for (const [index, year] of years.entries()) {
            const sortedDeltas = [...year.deltas].sort((a, b) => a - b);
            const median = percentile(sortedDeltas, 0.5);

            // Sampled every third day, so this is a three-day step and runs wider than
            // the day-to-day median the calibration script reports.
            assert.ok(
                median >= 6,
                `pair ${index}: median step was ${median}, expected at least 6 — the score is not moving`
            );

            assert.ok(
                year.autocorrelation <= 0.55,
                `pair ${index}: lag-1 autocorrelation was ${year.autocorrelation.toFixed(2)}, expected 0.55 or under — ` +
                    `the score is describing the fortnight rather than the day`
            );
        }
    });
});

describe("scoreDay", () => {
    it("is deterministic for the same pair and day", () => {
        const reader = chartOf(BIRTHS[0]);
        const person = chartOf(BIRTHS[1]);
        const baseOverall = calculateCompatibility(reader, person).overall;
        const transits = computeTransitChart(dayjs.utc("2026-06-15").toDate()) as TransitChart;

        const first = scoreDay({ readerChart: reader, personChart: person, baseOverall, transits });
        const second = scoreDay({ readerChart: reader, personChart: person, baseOverall, transits });

        assert.equal(first.score, second.score);
        assert.equal(first.compatibility.modifier, second.compatibility.modifier);
    });

    it("reads the same in both directions — the pair is not ordered", () => {
        const a = chartOf(BIRTHS[2]);
        const b = chartOf(BIRTHS[3]);
        const transits = computeTransitChart(dayjs.utc("2026-06-15").toDate()) as TransitChart;

        const forward = scoreDay({
            readerChart: a,
            personChart: b,
            baseOverall: calculateCompatibility(a, b).overall,
            transits,
        });

        const reverse = scoreDay({
            readerChart: b,
            personChart: a,
            baseOverall: calculateCompatibility(b, a).overall,
            transits,
        });

        assert.equal(forward.score, reverse.score);
    });
});
