/**
 * Simulates the levers that make the score behave like a daily forecast rather than
 * a trend. Writes nothing.
 *
 *   pnpm tsx src/scripts/simulateWeather.ts [--slowgain 0.6] [--p10 38] [--p90 74] [--mooncap 1]
 *
 * Three levers:
 *
 *   --slowgain   LAYER_GAIN.slow. Lowering it moves the score's LEVEL from slow
 *                bodies to fast ones, so the level itself changes day to day
 *                instead of drifting. This is the amplitude of the daily signal.
 *   --p10/--p90  the calibration target. Sigma is not just range, it is gain: a
 *                narrower sigma amplifies day-to-day differences and widens the
 *                range at the same time.
 *   --mooncap    caps how much of a Moon pair's impact goes to mood, redistributing
 *                the rest to that pair's other areas. The Moon is ~58% of all daily
 *                change and is currently wired almost entirely into mood, which is
 *                why career and love read as trends.
 *
 * Mutates LAYER_GAIN, ASPECT_RULES and CALIBRATION in memory, then refits the
 * normalisers so what is compared is real scores rather than a mis-centred squash.
 */
import { LIFE_AREAS, LifeArea } from "../modules/astro";
import { calculateDailyScore } from "../modules/dailyScore";
import { CALIBRATION } from "../modules/dailyScore/calibration";
import { LAYER_GAIN } from "../modules/dailyScore/factors";
import { ASPECT_RULES } from "../modules/dailyScore/rules";
import { argValue, buildSample, mean, percentile } from "./sampling";

const slowGain = argValue("slowgain", LAYER_GAIN.slow);
const targetP10 = argValue("p10", 38);
const targetP90 = argValue("p90", 74);
const moonCap = argValue("mooncap", 1);
const chartCount = argValue("charts", 40);
const dayCount = argValue("days", 365);

LAYER_GAIN.slow = slowGain;

if (moonCap < 1) {
    for (const rule of ASPECT_RULES) {
        if (!rule.pair.includes("moon")) {
            continue;
        }

        const mood = rule.areas.mood ?? 0;

        if (mood <= moonCap) {
            continue;
        }

        const excess = mood - moonCap;
        const others = LIFE_AREAS.filter((area) => area !== "mood");
        const otherTotal = others.reduce((sum, area) => sum + (rule.areas[area] ?? 0), 0);

        rule.areas = { ...rule.areas, mood: moonCap };

        if (otherTotal === 0) {
            // Nothing to grow: put it where the day is felt outwardly.
            rule.areas.career = excess;
            continue;
        }

        for (const area of others) {
            const share = rule.areas[area] ?? 0;

            if (share > 0) {
                rule.areas[area] = share + excess * (share / otherTotal);
            }
        }
    }
}

/**
 * Mercury is career's natural fast ruler at ~1.4 deg/day — work, exchange, the daily
 * texture of getting things done. Raising its importance is the astrologically
 * defensible way to give career a fast input it currently lacks.
 */
const mercuryBoost = argValue("mercuryboost", 1);

if (mercuryBoost !== 1) {
    for (const rule of ASPECT_RULES) {
        if (rule.pair.includes("mercury")) {
            rule.importance = Math.min(2, rule.importance * mercuryBoost);
        }
    }
}

console.log(
    `slowgain ${slowGain}  target p10 ${targetP10} / p90 ${targetP90}  mooncap ${moonCap}  ` +
        `mercuryboost ${mercuryBoost}  (${chartCount} charts x ${dayCount} days)`
);

/* ============================================================
   FIT AND SCORE
============================================================ */

type Key = LifeArea | "overall";
const KEYS = [...LIFE_AREAS, "overall"] as Key[];

const { subjects, transitCharts } = buildSample(chartCount, dayCount);

const rawByKey = Object.fromEntries(KEYS.map((key) => [key, [] as number[]])) as Record<Key, number[]>;

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
    const sigma = (p90 - p10) / (logit(targetP90) - logit(targetP10)) || 1;

    CALIBRATION[key] = { median: p10 - logit(targetP10) * sigma, sigma };
}

const perSubject = subjects.map((subject) => {
    const series = Object.fromEntries(KEYS.map((key) => [key, [] as number[]])) as Record<Key, number[]>;

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

    return series;
});

/* ============================================================
   METRICS
============================================================ */

function turningPoints(series: number[]): number {
    let count = 0;

    for (let i = 1; i < series.length - 1; i++) {
        const before = series[i] - series[i - 1];
        const after = series[i + 1] - series[i];

        if (before !== 0 && after !== 0 && Math.sign(before) !== Math.sign(after)) {
            count++;
        }
    }

    return (count / (series.length - 2)) * 30;
}

function quietWindows(series: number[]): number {
    let quiet = 0;
    let total = 0;

    for (let start = 0; start + 15 <= series.length; start++) {
        total++;

        if (turningPoints(series.slice(start, start + 15)) * (13 / 30) <= 3) {
            quiet++;
        }
    }

    return (quiet / total) * 100;
}

console.log("\n            |delta|   big jumps   turns/30d   quiet 15d   own p1-p99   <20    >80");

for (const key of KEYS) {
    const deltas = perSubject.flatMap((s) => s[key].slice(1).map((v, i) => Math.abs(v - s[key][i])));
    const big = (deltas.filter((d) => d >= 20).length / deltas.length) * 100;
    const all = perSubject.flatMap((s) => s[key]);
    const sorted = [...all].sort((a, b) => a - b);

    console.log(
        `  ${key.padEnd(9)}${mean(deltas).toFixed(1).padStart(8)}` +
            `${big.toFixed(0).padStart(11)}%` +
            `${mean(perSubject.map((s) => turningPoints(s[key])))
                .toFixed(1)
                .padStart(12)}` +
            `${mean(perSubject.map((s) => quietWindows(s[key])))
                .toFixed(0)
                .padStart(11)}%` +
            `${`${percentile(sorted, 0.01).toFixed(0)}-${percentile(sorted, 0.99).toFixed(0)}`.padStart(13)}` +
            `${((all.filter((v) => v < 20).length / all.length) * 100).toFixed(0).padStart(6)}%` +
            `${((all.filter((v) => v > 80).length / all.length) * 100).toFixed(0).padStart(6)}%`
    );
}

const spreads = perSubject.flatMap((s) =>
    s.love.map((_, i) => {
        const day = LIFE_AREAS.map((area) => s[area][i]);

        return Math.max(...day) - Math.min(...day);
    })
);

console.log(
    `\n  same-day area spread: median ${percentile(
        [...spreads].sort((a, b) => a - b),
        0.5
    ).toFixed(0)}` +
        `  p90 ${percentile(
            [...spreads].sort((a, b) => a - b),
            0.9
        ).toFixed(0)}`
);

console.log("\n  sample fortnight (chart 0)");
for (const key of KEYS) {
    console.log(
        `    ${key.padEnd(9)}${perSubject[0][key]
            .slice(0, 15)
            .map((v) => String(v).padStart(4))
            .join("")}`
    );
}
