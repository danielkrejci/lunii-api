/**
 * Fits the logistic normalisers for people compatibility.
 *
 * The raw sums the engine produces have no natural scale — it depends entirely on the
 * rule tables and on the factors in modules/compatibilityPeople/factors.ts — so
 * median/sigma must be measured, never guessed. Re-run this whenever either changes.
 *
 *   pnpm tsx src/scripts/calibrateCompatibility.ts [--pairs 200] [--days 365] [--write]
 *
 * Deterministic: the charts come from the same seeded sample the daily-score
 * calibration uses, so the same arguments always produce the same constants.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { NatalChart as AstroChart } from "../modules/astro";
import { calculateCompatibility, calculateDailyCompatibility } from "../modules/compatibilityPeople/aspects";
import { normalizeScore } from "../modules/compatibilityPeople/normalizer";
import { NatalChart, TransitChart } from "../modules/compatibilityPeople/types";
import { argValue, buildSample, describe, histogram, mulberry32, percentile, round2, SEED } from "./sampling";

/**
 * How compatible are we, across everyone. A cross-pair comparison, so it is fitted on
 * the pooled distribution — that is what the number is asking.
 *
 * Floored well above 0 and capped below 100 on purpose: this one is a verdict on a
 * relationship the user is in, and there is no version of it that should read as 4 %.
 */
const BASE_TARGET = { p10: 30, p90: 80 };

/**
 * How is today, for these two. A within-pair comparison, so it is fitted on deviations
 * from each pair's own median — see calibratePair in pairCalibration.ts.
 *
 * Symmetric around 50, unlike the daily score's 25/85. A daily horoscope is read alone
 * and may flatter; "you two are at 88 % today" is a claim about somebody else as well,
 * and it should cost as much to reach as its mirror image.
 */
const DAILY_TARGET = { p10: 25, p90: 75 };

const logit = (score: number) => Math.log(score / (100 - score));

/** Solves median/sigma so the raw p10/p90 land on the target score percentiles. */
function fit(rawValues: number[], target: { p10: number; p90: number }): { median: number; sigma: number } {
    const sorted = [...rawValues].sort((a, b) => a - b);

    const rawP10 = percentile(sorted, 0.1);
    const rawP90 = percentile(sorted, 0.9);

    const sigma = (rawP90 - rawP10) / (logit(target.p90) - logit(target.p10));

    return { median: round2(rawP10 - logit(target.p10) * sigma), sigma: round2(sigma) };
}

function standardDeviation(values: number[]): number {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;

    return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

/** Lag-1 autocorrelation. High means the score is describing the fortnight, not the day. */
function autocorrelation(series: number[]): number {
    const mean = series.reduce((sum, value) => sum + value, 0) / series.length;

    let numerator = 0;
    let denominator = 0;

    for (const [index, value] of series.entries()) {
        denominator += (value - mean) ** 2;

        if (index + 1 < series.length) {
            numerator += (value - mean) * (series[index + 1] - mean);
        }
    }

    return denominator === 0 ? 0 : numerator / denominator;
}

/* ============================================================
   RUN
============================================================ */

const pairCount = argValue("pairs", 200);
const dayCount = argValue("days", 365);

// Two subjects per pair, so no chart is reused and the cohort is genuinely 2N charts.
const { subjects, transitCharts } = buildSample(pairCount * 2, dayCount);

const random = mulberry32(SEED ^ 0x9e_37_79_b9);

const pairs = Array.from({ length: pairCount }, (_, index) => {
    // Shuffle which half a subject comes from, so reader and person are not
    // systematically drawn from different parts of the sampled birth-date range.
    const flip = random() > 0.5;

    return flip
        ? { reader: subjects[index * 2].chart, person: subjects[index * 2 + 1].chart }
        : { reader: subjects[index * 2 + 1].chart, person: subjects[index * 2].chart };
});

console.log(`${pairCount} pairs x ${dayCount} days = ${(pairCount * dayCount).toLocaleString("en-US")} daily scores\n`);

const baseRaws: number[] = [];

/** raw − that pair's own median. What DAILY_SIGMA is fitted on. */
const deviations: number[] = [];

const perPairRaws: number[][] = [];
const perPairMedian: number[] = [];

for (const pair of pairs) {
    const reader = pair.reader as AstroChart as NatalChart;
    const person = pair.person as AstroChart as NatalChart;

    const base = calculateCompatibility(reader, person);

    baseRaws.push(base.overall);

    const raws = transitCharts.map(
        (transits) => base.overall + calculateDailyCompatibility(transits as TransitChart, reader, person).modifier
    );

    const sorted = [...raws].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    perPairRaws.push(raws);
    perPairMedian.push(median);

    for (const raw of raws) {
        deviations.push(raw - median);
    }
}

console.log("raw sums (pre-squash)");
console.log(`  base            ${describe(baseRaws)}`);
console.log(`  daily           ${describe(perPairRaws.flat())}`);
console.log(`  daily deviation ${describe(deviations)}`);

const baseFit = fit(baseRaws, BASE_TARGET);
const dailyFit = fit(deviations, DAILY_TARGET);

console.log("\nfitted normalisers");
console.log(`  BASE_NORMALIZER  median ${baseFit.median}  sigma ${baseFit.sigma}`);
console.log(`  DAILY_SIGMA      ${dailyFit.sigma}   (fitted median ${dailyFit.median}, must be ~0)`);

/* ============================================================
   RESULTING DISTRIBUTIONS
============================================================ */

const baseScores = baseRaws.map((raw) => normalizeScore(raw, baseFit));

console.log("\nresulting baseScore");
console.log(`  ${describe(baseScores)}`);
console.log(histogram(baseScores));

const dailyScores: number[] = [];
const withinPairSpread: number[] = [];
const dailyDeltas: number[] = [];
const autocorrelations: number[] = [];

/** A pair whose whole year fits in a narrow band — the failure this refit is aimed at. */
let flatPairs = 0;

for (const [index, raws] of perPairRaws.entries()) {
    const config = { median: perPairMedian[index], sigma: dailyFit.sigma };
    const scores = raws.map((raw) => normalizeScore(raw, config));

    dailyScores.push(...scores);

    const sorted = [...scores].sort((a, b) => a - b);
    const spread = percentile(sorted, 0.9) - percentile(sorted, 0.1);

    withinPairSpread.push(spread);

    if (spread < 20) {
        flatPairs++;
    }

    for (const [day, score] of scores.entries()) {
        if (day > 0) {
            dailyDeltas.push(Math.abs(score - scores[day - 1]));
        }
    }

    autocorrelations.push(autocorrelation(scores));
}

console.log("\nresulting daily score, pooled across pairs");
console.log(`  ${describe(dailyScores)}  sd ${standardDeviation(dailyScores).toFixed(1)}`);
console.log(histogram(dailyScores));

const sortedSpread = [...withinPairSpread].sort((a, b) => a - b);
const sortedDeltas = [...dailyDeltas].sort((a, b) => a - b);
const sortedAuto = [...autocorrelations].sort((a, b) => a - b);

console.log("\nper-pair dynamics — the point of the exercise");
console.log(
    `  p10-p90 spread WITHIN one pair's year: median ${percentile(sortedSpread, 0.5).toFixed(1)}  ` +
        `p10 ${percentile(sortedSpread, 0.1).toFixed(1)}  min ${sortedSpread[0].toFixed(1)}`
);
console.log(`  pairs whose whole year spans under 20 points: ${flatPairs} of ${pairCount}`);
console.log(
    `  |delta| day to day: median ${percentile(sortedDeltas, 0.5).toFixed(1)}  ` +
        `p90 ${percentile(sortedDeltas, 0.9).toFixed(1)}   (target median 8-15)`
);
console.log(
    `  lag-1 autocorrelation: median ${percentile(sortedAuto, 0.5).toFixed(2)}  ` +
        `p90 ${percentile(sortedAuto, 0.9).toFixed(2)}   (target under 0.5)`
);

/* ============================================================
   WRITE
============================================================ */

if (process.argv.includes("--write")) {
    const target = join(import.meta.dirname, "..", "modules", "compatibilityPeople", "calibration.ts");

    const file = `import { NormalizerConfig } from "./types";

/**
 * Generated by src/scripts/calibrateCompatibility.ts — do not hand-edit.
 *
 * Fitted from ${pairCount} pairs x ${dayCount} days (seed ${SEED}).
 *
 * These numbers describe THIS pair of rule tables and THIS set of factors. Re-run the
 * calibration whenever src/modules/compatibilityPeople/rules.ts or ./factors.ts change.
 */

/**
 * How compatible two people are, full stop — the number behind \`baseScore\`.
 *
 * Fitted on the POOLED distribution across pairs, to land it on score percentiles
 * p10 ${BASE_TARGET.p10} / p90 ${BASE_TARGET.p90}. Pooled is right here: this one is a comparison against
 * every other pair, and it is the same for them tomorrow as it is today.
 */
export const BASE_NORMALIZER: NormalizerConfig = { median: ${baseFit.median}, sigma: ${baseFit.sigma} };

/**
 * How wide the squash opens around a pair's own median — the gain on the daily score.
 *
 * Fitted on DEVIATIONS from each pair's median rather than on the pooled raws, to land
 * a single pair's own year on score percentiles p10 ${DAILY_TARGET.p10} / p90 ${DAILY_TARGET.p90}. Fitting the pooled
 * distribution instead is what produced the flat scores this replaced: most of that
 * spread is the gap BETWEEN pairs, so sigma came out wide enough to swallow everything
 * a single pair's sky does over a year.
 *
 * The median is not here because there is no global one — \`calibratePair\` measures it
 * per pair. Sigma stays shared so a turbulent pair keeps its turbulence.
 */
export const DAILY_SIGMA = ${dailyFit.sigma};
`;

    writeFileSync(target, file, "utf8");

    console.log(`\nWrote ${target}`);
    console.log("Re-run without --write to verify the resulting distribution.");
}
