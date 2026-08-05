/**
 * Simulates parameter changes against the metrics a user actually sees, before
 * anything is written to rules.ts or calibration.ts.
 *
 *   pnpm tsx src/scripts/simulateDynamics.ts                          # current state
 *   pnpm tsx src/scripts/simulateDynamics.ts --gamma 3 --floor 0.15   # concentrate areas
 *   pnpm tsx src/scripts/simulateDynamics.ts --p10 28 --p90 80        # widen the target
 *
 * Two levers, two different complaints:
 *
 *   --gamma / --floor  sharpen each rule's area distribution, so one aspect can
 *                      push love without dragging career along. Fixes areas being
 *                      near-identical.
 *   --p10 / --p90      the calibration target, i.e. how dramatic the numbers are.
 *                      Fixes the score barely moving over a week.
 *
 * Mutates ASPECT_RULES and CALIBRATION in memory so the real engine formula is
 * used, then refits the normalisers for the modified table — comparing without
 * refitting would measure a mis-centred squash rather than the change itself.
 */
import { LIFE_AREAS, LifeArea } from "../modules/astro";
import { calculateDailyScore } from "../modules/dailyScore";
import { CALIBRATION } from "../modules/dailyScore/calibration";
import { ASPECT_RULES } from "../modules/dailyScore/rules";
import { argValue, buildSample, mean, percentile } from "./sampling";

const gamma = argValue("gamma", 1);
const floor = argValue("floor", 0);
const targetP10 = argValue("p10", 38);
const targetP90 = argValue("p90", 74);
const chartCount = argValue("charts", 60);
const dayCount = argValue("days", 365);

console.log(
    `gamma ${gamma}  floor ${floor}  target p10 ${targetP10} / p90 ${targetP90}  ` +
        `(${chartCount} charts x ${dayCount} days)\n`
);

/* ============================================================
   TRANSFORM THE RULE TABLE
============================================================ */

if (gamma !== 1 || floor > 0) {
    for (const rule of ASPECT_RULES) {
        const entries = Object.entries(rule.areas) as [LifeArea, number][];

        // Raise to a power, then drop anything still below the floor, then renormalise.
        const raised = entries.map(([area, share]) => [area, share ** gamma] as [LifeArea, number]);
        const raisedTotal = raised.reduce((sum, [, share]) => sum + share, 0);
        const normalized = raised.map(([area, share]) => [area, share / raisedTotal] as [LifeArea, number]);

        const kept = normalized.filter(([, share]) => share >= floor);
        const keptTotal = kept.reduce((sum, [, share]) => sum + share, 0);

        const next: Partial<Record<LifeArea, number>> = {};

        for (const [area, share] of kept) {
            next[area] = share / keptTotal;
        }

        rule.areas = next;
    }
}

const dominantShares = ASPECT_RULES.map((rule) => Math.max(...(Object.values(rule.areas) as number[])));
const areaCounts = ASPECT_RULES.map((rule) => Object.keys(rule.areas).length);

console.log(
    `rule table: dominant share mean ${mean(dominantShares).toFixed(2)} ` +
        `(max ${Math.max(...dominantShares).toFixed(2)})  areas per rule ${mean(areaCounts).toFixed(2)} of 4`
);

/* ============================================================
   FIT, THEN MEASURE
============================================================ */

const { subjects, transitCharts } = buildSample(chartCount, dayCount);

type Series = Record<LifeArea | "overall", number[]>;

const KEYS = [...LIFE_AREAS, "overall"] as (LifeArea | "overall")[];

function collect(): Series[] {
    return subjects.map((subject) => {
        const series: Series = { love: [], career: [], health: [], mood: [], overall: [] };

        for (const transits of transitCharts) {
            const result = calculateDailyScore({
                natal: subject.chart,
                transits,
                hasBirthTime: subject.hasBirthTime,
            });

            for (const area of LIFE_AREAS) {
                series[area].push(result.scores[`${area}Score` as keyof typeof result.scores]);
            }

            series.overall.push(result.scores.overallScore);
        }

        return series;
    });
}

// Pass 1: raw sums, so the normalisers can be refitted for the modified table.
const rawByKey: Record<LifeArea | "overall", number[]> = {
    love: [],
    career: [],
    health: [],
    mood: [],
    overall: [],
};

for (const subject of subjects) {
    for (const transits of transitCharts) {
        const { raw } = calculateDailyScore({
            natal: subject.chart,
            transits,
            hasBirthTime: subject.hasBirthTime,
        });

        for (const key of KEYS) {
            rawByKey[key].push(raw[key]);
        }
    }
}

const logit = (score: number) => Math.log(score / (100 - score));

for (const key of KEYS) {
    const sorted = [...rawByKey[key]].sort((a, b) => a - b);
    const p10 = percentile(sorted, 0.1);
    const p90 = percentile(sorted, 0.9);
    const sigma = (p90 - p10) / (logit(targetP90) - logit(targetP10));

    CALIBRATION[key] = {
        median: Math.round((p10 - logit(targetP10) * sigma) * 100) / 100,
        sigma: Math.round(sigma * 100) / 100,
    };
}

console.log("refitted:", KEYS.map((key) => `${key} sigma ${CALIBRATION[key].sigma}`).join("  "));

// Pass 2: scores under the refitted normalisers.
const perSubject = collect();

/* ============================================================
   REPORT
============================================================ */

const variance = (values: number[]) => {
    const m = mean(values);

    return mean(values.map((v) => (v - m) ** 2));
};

const med = (values: number[]) =>
    percentile(
        [...values].sort((a, b) => a - b),
        0.5
    );

console.log("\nwhat one user sees over their own year (median across users)");
console.log("            own p5-p95   mean |delta|   7-day window range");

for (const key of KEYS) {
    const spans = perSubject.map((s) => {
        const sorted = [...s[key]].sort((a, b) => a - b);

        return percentile(sorted, 0.95) - percentile(sorted, 0.05);
    });

    const deltas = perSubject.map((s) => mean(s[key].slice(1).map((value, index) => Math.abs(value - s[key][index]))));

    const windows = perSubject.flatMap((s) => {
        const out: number[] = [];

        for (let start = 0; start + 7 <= s[key].length; start++) {
            const week = s[key].slice(start, start + 7);

            out.push(Math.max(...week) - Math.min(...week));
        }

        return out;
    });

    console.log(
        `  ${key.padEnd(9)}${med(spans).toFixed(1).padStart(11)}${med(deltas).toFixed(1).padStart(15)}` +
            `${med(windows).toFixed(1).padStart(21)}`
    );
}

const flat = Object.fromEntries(KEYS.map((key) => [key, perSubject.flatMap((s) => s[key])])) as Series;

function correlation(a: number[], b: number[]): number {
    const ma = mean(a);
    const mb = mean(b);

    return mean(a.map((value, index) => (value - ma) * (b[index] - mb))) / Math.sqrt(variance(a) * variance(b) || 1e-9);
}

const pairs: [LifeArea, LifeArea][] = [
    ["love", "career"],
    ["love", "health"],
    ["love", "mood"],
    ["career", "health"],
    ["career", "mood"],
    ["health", "mood"],
];

console.log(
    "\ncross-area correlation: " +
        pairs
            .map(([a, b]) => `${a.slice(0, 2)}/${b.slice(0, 2)} ${correlation(flat[a], flat[b]).toFixed(2)}`)
            .join("  ")
);
console.log(`  mean ${mean(pairs.map(([a, b]) => correlation(flat[a], flat[b]))).toFixed(2)}`);

const spreads = perSubject.flatMap((s) =>
    s.love.map((_, index) => {
        const day = LIFE_AREAS.map((area) => s[area][index]);

        return Math.max(...day) - Math.min(...day);
    })
);

const sortedSpreads = [...spreads].sort((a, b) => a - b);

console.log(
    `\nsame-day spread across the four areas: median ${percentile(sortedSpreads, 0.5).toFixed(0)}` +
        `  p90 ${percentile(sortedSpreads, 0.9).toFixed(0)}` +
        `  p99 ${percentile(sortedSpreads, 0.99).toFixed(0)}` +
        `  max ${(sortedSpreads.at(-1) ?? 0).toFixed(0)}`
);
console.log(
    `  share of days with a spread of 40+: ${((spreads.filter((s) => s >= 40).length / spreads.length) * 100).toFixed(1)}%`
);

const overallAll = flat.overall;
const sortedOverall = [...overallAll].sort((a, b) => a - b);

console.log(
    `\npopulation overall: mean ${mean(overallAll).toFixed(1)}  p10 ${percentile(sortedOverall, 0.1).toFixed(0)}` +
        `  p90 ${percentile(sortedOverall, 0.9).toFixed(0)}` +
        `  below 30: ${((overallAll.filter((v) => v < 30).length / overallAll.length) * 100).toFixed(1)}%` +
        `  above 80: ${((overallAll.filter((v) => v > 80).length / overallAll.length) * 100).toFixed(1)}%`
);
