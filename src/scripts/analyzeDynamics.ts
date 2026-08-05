/**
 * How much the score actually moves, and how much the four areas differ.
 *
 * The population distribution (p10 38 / p90 74) mixes two things: how much one
 * user's score moves over time, and how much users differ from each other. A user
 * only ever sees the first. This script separates them.
 *
 *   pnpm tsx src/scripts/analyzeDynamics.ts [--charts 60] [--days 365]
 */
import { LIFE_AREAS, LifeArea } from "../modules/astro";
import { calculateDailyScore } from "../modules/dailyScore";
import { ASPECT_RULES } from "../modules/dailyScore/rules";
import { argValue, buildSample, mean, percentile } from "./sampling";

const chartCount = argValue("charts", 60);
const dayCount = argValue("days", 365);

const { subjects, transitCharts } = buildSample(chartCount, dayCount);

type Series = Record<LifeArea | "overall", number[]>;

const perSubject: Series[] = [];

for (const subject of subjects) {
    const series: Series = { love: [], career: [], health: [], mood: [], overall: [] };

    for (const transits of transitCharts) {
        const { scores } = calculateDailyScore({
            natal: subject.chart,
            transits,
            hasBirthTime: subject.hasBirthTime,
        });

        series.love.push(scores.loveScore);
        series.career.push(scores.careerScore);
        series.health.push(scores.healthScore);
        series.mood.push(scores.moodScore);
        series.overall.push(scores.overallScore);
    }

    perSubject.push(series);
}

const KEYS = [...LIFE_AREAS, "overall"] as (LifeArea | "overall")[];

const variance = (values: number[]) => {
    const m = mean(values);

    return mean(values.map((v) => (v - m) ** 2));
};

/* ============================================================
   1. WHAT ONE USER SEES
============================================================ */

console.log(`${chartCount} charts x ${dayCount} days\n`);
console.log("what a single user sees over their own year (median across users)");
console.log("            own p5-p95   own min-max   mean |delta|   7-day window range");

for (const key of KEYS) {
    const spans = perSubject.map((s) => {
        const sorted = [...s[key]].sort((a, b) => a - b);

        return percentile(sorted, 0.95) - percentile(sorted, 0.05);
    });

    const fullSpans = perSubject.map((s) => Math.max(...s[key]) - Math.min(...s[key]));

    const deltas = perSubject.map((s) => mean(s[key].slice(1).map((value, index) => Math.abs(value - s[key][index]))));

    // Exactly what the app's timeline shows: the spread inside one visible week.
    const windows = perSubject.flatMap((s) => {
        const out: number[] = [];

        for (let start = 0; start + 7 <= s[key].length; start++) {
            const week = s[key].slice(start, start + 7);

            out.push(Math.max(...week) - Math.min(...week));
        }

        return out;
    });

    console.log(
        `  ${key.padEnd(9)}` +
            `${percentile(
                [...spans].sort((a, b) => a - b),
                0.5
            )
                .toFixed(1)
                .padStart(11)}` +
            `${percentile(
                [...fullSpans].sort((a, b) => a - b),
                0.5
            )
                .toFixed(1)
                .padStart(14)}` +
            `${percentile(
                [...deltas].sort((a, b) => a - b),
                0.5
            )
                .toFixed(1)
                .padStart(15)}` +
            `${percentile(
                [...windows].sort((a, b) => a - b),
                0.5
            )
                .toFixed(1)
                .padStart(21)}`
    );
}

/* ============================================================
   2. WHERE THE SPREAD LIVES
============================================================ */

console.log("\nvariance decomposition: movement over time vs difference between users");
console.log("            total    within-user   between-user   within share");

for (const key of KEYS) {
    const all = perSubject.flatMap((s) => s[key]);
    const total = variance(all);
    const within = mean(perSubject.map((s) => variance(s[key])));
    const between = variance(perSubject.map((s) => mean(s[key])));

    console.log(
        `  ${key.padEnd(9)}` +
            `${total.toFixed(1).padStart(7)}` +
            `${within.toFixed(1).padStart(14)}` +
            `${between.toFixed(1).padStart(15)}` +
            `${((within / total) * 100).toFixed(0).padStart(14)}%`
    );
}

console.log("  the calibrated p10-p90 of 38-74 is the TOTAL spread; a user only ever sees the within part");

/* ============================================================
   3. HOW ALIKE THE FOUR AREAS ARE
============================================================ */

function correlation(a: number[], b: number[]): number {
    const ma = mean(a);
    const mb = mean(b);
    const cov = mean(a.map((value, index) => (value - ma) * (b[index] - mb)));

    return cov / Math.sqrt(variance(a) * variance(b) || 1e-9);
}

console.log("\ncross-area correlation (1.0 = the four areas are the same number)");
console.log(`             ${LIFE_AREAS.map((area) => area.padStart(8)).join("")}`);

const flat = Object.fromEntries(KEYS.map((key) => [key, perSubject.flatMap((s) => s[key])])) as Series;

for (const rowArea of LIFE_AREAS) {
    console.log(
        `  ${rowArea.padEnd(9)}  ` +
            LIFE_AREAS.map((colArea) => correlation(flat[rowArea], flat[colArea]).toFixed(2).padStart(8)).join("")
    );
}

const spreads = perSubject.flatMap((s) =>
    s.love.map((_, index) => {
        const day = LIFE_AREAS.map((area) => s[area][index]);

        return Math.max(...day) - Math.min(...day);
    })
);

const sortedSpreads = [...spreads].sort((a, b) => a - b);

console.log(
    `\n  spread between the four areas on the same day: median ${percentile(sortedSpreads, 0.5).toFixed(1)}` +
        `  p90 ${percentile(sortedSpreads, 0.9).toFixed(1)}  max ${sortedSpreads.at(-1).toFixed(0)}`
);
console.log("  a day like 'love 90 / career 20' needs a spread of 70");

/* ============================================================
   4. HOW CONCENTRATED THE RULES ARE
============================================================ */

const dominantShares = ASPECT_RULES.map((rule) => Math.max(...(Object.values(rule.areas) as number[])));
const areaCounts = ASPECT_RULES.map((rule) => Object.keys(rule.areas).length);

console.log("\nrule table: how concentrated each rule's areas are");
console.log(
    `  dominant area share: mean ${mean(dominantShares).toFixed(2)}` +
        `  min ${Math.min(...dominantShares).toFixed(2)}  max ${Math.max(...dominantShares).toFixed(2)}`
);
console.log(`  areas touched per rule: mean ${mean(areaCounts).toFixed(2)} of 4`);
console.log("  a rule spreading its impact over all four areas cannot make one area diverge from the rest");
