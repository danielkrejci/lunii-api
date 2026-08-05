/**
 * Fits the logistic normalisers for the daily score.
 *
 * The raw sums the engine produces have no natural scale — it depends entirely on
 * the rule table — so median/sigma must be measured, never guessed. Re-run this
 * whenever the rule table changes.
 *
 *   pnpm tsx src/scripts/calibrateDailyScore.ts [--charts 300] [--days 730] [--write]
 *
 * Deterministic: a seeded PRNG, so the same arguments always produce the same
 * constants. Math.random() would make the calibration unreproducible.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { LIFE_AREAS, LifeArea, Planet, PLANETS } from "../modules/astro";
import { calculateDailyScore, summarizePlanetWeight } from "../modules/dailyScore";
import { argValue, buildSample, describe, histogram, percentile, round2, SEED } from "./sampling";

/**
 * A daily forecast, not a trend. Product decision, not an astrological one.
 *
 * Widened from 38/74 on 2026-08-05 to use most of the 0-100 range and to let
 * genuinely bad and genuinely good days exist. Sigma is not only range, it is gain:
 * a narrower sigma amplifies day-to-day differences and widens the distribution in
 * the same move, so this single pair of numbers controls both amplitude and contrast.
 *
 * The fit below solves for the median/sigma that land the raw distribution on these
 * score percentiles.
 */
const TARGET = { p10: 25, p90: 85 };

const logit = (score: number) => Math.log(score / (100 - score));

/** Solves median/sigma so the raw p10/p90 land on the target score percentiles. */
function fit(rawValues: number[]): { median: number; sigma: number } {
    const sorted = [...rawValues].sort((a, b) => a - b);

    const rawP10 = percentile(sorted, 0.1);
    const rawP90 = percentile(sorted, 0.9);

    const sigma = (rawP90 - rawP10) / (logit(TARGET.p90) - logit(TARGET.p10));

    return { median: round2(rawP10 - logit(TARGET.p10) * sigma), sigma: round2(sigma) };
}

/* ============================================================
   RUN
============================================================ */

const chartCount = argValue("charts", 300);
const dayCount = argValue("days", 730);

const { subjects, transitCharts } = buildSample(chartCount, dayCount);

console.log(`${chartCount} charts x ${dayCount} days = ${(chartCount * dayCount).toLocaleString("en-US")} scores\n`);

const rawByArea: Record<LifeArea | "overall", number[]> = {
    love: [],
    career: [],
    health: [],
    mood: [],
    overall: [],
};

/**
 * Per-body loudness, so "Mars 82" means loud for Mars rather than loud compared to
 * the Moon. Days where a body makes no aspect are excluded from its fit — they are
 * reported as 0 and would otherwise drag the whole scale toward zero.
 */
const planetWeights = Object.fromEntries(PLANETS.map((planet) => [planet, [] as number[]])) as Record<Planet, number[]>;

const coveredWeights: number[] = [];
const confidences: number[] = [];
const dailyDeltas: number[] = [];
const overallScores: number[] = [];

let unresolvedTotal = 0;

for (const subject of subjects) {
    let previousOverall: number | null = null;

    for (const transits of transitCharts) {
        const result = calculateDailyScore({
            natal: subject.chart,
            transits,
            hasBirthTime: subject.hasBirthTime,
        });

        for (const area of LIFE_AREAS) {
            rawByArea[area].push(result.raw[area]);
        }

        rawByArea.overall.push(result.raw.overall);

        const byPlanet = summarizePlanetWeight(result.impacts);

        for (const planet of PLANETS) {
            if (byPlanet[planet].hits.size > 0) {
                planetWeights[planet].push(byPlanet[planet].weight);
            }
        }

        coveredWeights.push(result.coveredWeight);
        confidences.push(result.confidence);
        overallScores.push(result.scores.overallScore);
        unresolvedTotal += result.unresolved.length;

        if (previousOverall !== null) {
            dailyDeltas.push(Math.abs(result.scores.overallScore - previousOverall));
        }

        previousOverall = result.scores.overallScore;
    }
}

console.log("raw sums (pre-squash)");
for (const key of [...LIFE_AREAS, "overall"] as (LifeArea | "overall")[]) {
    console.log(`  ${key.padEnd(8)} ${describe(rawByArea[key])}`);
}

const fitted = {
    love: fit(rawByArea.love),
    career: fit(rawByArea.career),
    health: fit(rawByArea.health),
    mood: fit(rawByArea.mood),
    overall: fit(rawByArea.overall),
};

console.log("\nfitted normalisers");
for (const [key, config] of Object.entries(fitted)) {
    console.log(`  ${key.padEnd(8)} median ${String(config.median).padStart(8)}  sigma ${config.sigma}`);
}

console.log("\nresulting overallScore with the CURRENT constants");
console.log(`  ${describe(overallScores)}`);
console.log(histogram(overallScores));

console.log("\nvolatility (tunes LAYER_GAIN.slow; target median 4-6)");
const sortedDeltas = [...dailyDeltas].sort((a, b) => a - b);
console.log(
    `  |delta overallScore| day to day: median ${percentile(sortedDeltas, 0.5).toFixed(1)}  ` +
        `p90 ${percentile(sortedDeltas, 0.9).toFixed(1)}`
);

console.log("\ncoverage");
console.log(`  unresolved hits: ${unresolvedTotal} (must be 0)`);
console.log(`  confidence: ${describe(confidences.map((value) => value * 100))} (x100)`);
console.log(`  coveredWeight: ${describe(coveredWeights)}`);

const sortedWeights = [...coveredWeights].sort((a, b) => a - b);

/**
 * p90 rather than the median: with the median half of all rows would clamp to
 * exactly 1.00 and confidence would stop carrying information for them.
 */
const expectedWeight = round2(percentile(sortedWeights, 0.9));

console.log(`  EXPECTED_WEIGHT candidate (p90): ${expectedWeight}`);

const planetFitted = Object.fromEntries(PLANETS.map((planet) => [planet, fit(planetWeights[planet])])) as Record<
    Planet,
    { median: number; sigma: number }
>;

console.log("\nper-planet loudness (days with at least one aspect)");
for (const planet of PLANETS) {
    const sorted = [...planetWeights[planet]].sort((a, b) => a - b);
    const active = (planetWeights[planet].length / (chartCount * dayCount)) * 100;

    console.log(
        `  ${planet.padEnd(9)} active ${active.toFixed(0).padStart(3)}% of days` +
            `  weight p10 ${percentile(sorted, 0.1).toFixed(1).padStart(5)}` +
            `  p90 ${percentile(sorted, 0.9).toFixed(1).padStart(5)}` +
            `  -> median ${String(planetFitted[planet].median).padStart(6)} sigma ${planetFitted[planet].sigma}`
    );
}

if (process.argv.includes("--write")) {
    const target = join(import.meta.dirname, "..", "modules", "dailyScore", "calibration.ts");

    // Identifies this exact set of constants, so two refits on one day differ.
    const fingerprint = createHash("sha256")
        .update(JSON.stringify({ fitted, expectedWeight, target: TARGET }))
        .digest("hex")
        .slice(0, 8);

    const file = `import { LifeArea, Planet } from "../astro";

export interface NormalizerConfig {
    /** Raw sum that maps to a score of 50. */
    median: number;
    /** Raw spread that maps to roughly ±23 score points. Larger = flatter scores. */
    sigma: number;
}

/**
 * Generated by src/scripts/calibrateDailyScore.ts — do not hand-edit.
 *
 * Fitted from ${chartCount} charts x ${dayCount} days (seed ${SEED}) to land the raw
 * distribution on target score percentiles p10 ${TARGET.p10} / p90 ${TARGET.p90}.
 *
 * These numbers describe THIS rule table. Re-run the calibration whenever
 * src/modules/dailyScore/rules.ts changes.
 */
export const CALIBRATION: Record<LifeArea | "overall", NormalizerConfig> = {
    love: { median: ${fitted.love.median}, sigma: ${fitted.love.sigma} },
    career: { median: ${fitted.career.median}, sigma: ${fitted.career.sigma} },
    health: { median: ${fitted.health.median}, sigma: ${fitted.health.sigma} },
    mood: { median: ${fitted.mood.median}, sigma: ${fitted.mood.sigma} },
    overall: { median: ${fitted.overall.median}, sigma: ${fitted.overall.sigma} },
};

/**
 * How loud each transiting body is for its own norm, fitted only over days on which
 * it actually aspects the chart. Without a per-body fit the Moon would report ~90
 * every day and Neptune ~5, which says nothing about today.
 */
export const PLANET_CALIBRATION: Record<Planet, NormalizerConfig> = {
${PLANETS.map((planet) => `    ${planet}: { median: ${planetFitted[planet].median}, sigma: ${planetFitted[planet].sigma} },`).join("\n")}
};

/**
 * Aspect weight (Σ importance × strength) a RICH day produces — the p90 of the
 * calibration sample. Denominator for \`confidence\`, so a typical day lands below
 * 1 and only genuinely dense days clamp.
 */
export const EXPECTED_WEIGHT = ${expectedWeight};

/** Applied to confidence when the birth time is unknown: no Ascendant, imprecise natal Moon. */
export const NO_BIRTH_TIME_CONFIDENCE_PENALTY = 0.85;

/**
 * Stamped on every row, so a score can be told apart from one fitted to a later
 * table. The suffix hashes the AREA constants only — those are what stored rows
 * depend on. PLANET_CALIBRATION is computed fresh on every request and stored
 * nowhere, so changing it must not mark existing rows stale.
 */
export const CALIBRATION_VERSION = "${new Date().toISOString().slice(0, 10)}-${fingerprint}";
`;

    writeFileSync(target, file, "utf8");

    console.log(`\nWrote ${target}`);
    console.log("Re-run without --write to verify the resulting distribution.");
}
