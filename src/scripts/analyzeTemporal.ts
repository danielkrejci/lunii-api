/**
 * Why one area's score is so smooth over time, and whether the orb taper is the cause.
 *
 * Changes nothing. Simulates alternative tapers by building AspectHits with a custom
 * strength and running them through the real resolveAspectRule / buildImpacts, then
 * refitting the normalisers — comparing without a refit would measure a mis-centred
 * squash instead of the taper.
 *
 *   pnpm tsx src/scripts/analyzeTemporal.ts [--charts 30] [--days 240]
 */
import {
    ASPECT_GROUP,
    AspectHit,
    findAspect,
    LIFE_AREAS,
    LifeArea,
    NatalChart,
    NATAL_POINTS,
    Planet,
    PLANETS,
    TransitChart,
} from "../modules/astro";
import { buildImpacts, resolveAspectRule } from "../modules/dailyScore";
import { AREA_WEIGHTS } from "../modules/dailyScore/factors";
import { argValue, buildSample, mean, percentile } from "./sampling";

const chartCount = argValue("charts", 30);
const dayCount = argValue("days", 240);

const { subjects, transitCharts } = buildSample(chartCount, dayCount);

type Key = LifeArea | "overall";
const KEYS = [...LIFE_AREAS, "overall"] as Key[];

/* ============================================================
   TAPERS
============================================================ */

interface Taper {
    label: string;
    of: (orb: number, maxOrb: number) => number;
}

const power = (exponent: number): Taper => ({
    label: `(1-orb/max)^${exponent}`,
    of: (orb, maxOrb) => Math.max(0, 1 - orb / maxOrb) ** exponent,
});

/** exp(-(orb/(max/2))^2): a soft bell whose half-orb point sits near 0.37. */
const gaussian: Taper = {
    label: "gaussian",
    of: (orb, maxOrb) => Math.exp(-((orb / (maxOrb / 2)) ** 2)),
};

const TAPERS: Taper[] = [power(1), power(2), power(3), gaussian];

/* ============================================================
   ENGINE WITH A SUBSTITUTED TAPER
============================================================ */

/**
 * Mirrors findTransitToNatalAspects, with strength supplied by the taper under test.
 * Everything after this point is the real engine.
 */
function hitsFor(transits: TransitChart, natal: NatalChart, taper: Taper, widenMoon: boolean): AspectHit[] {
    const hits: AspectHit[] = [];

    for (const transit of PLANETS) {
        for (const natalPoint of NATAL_POINTS) {
            const natalPosition = natal[natalPoint];

            if (!natalPosition) {
                continue;
            }

            const bonus = widenMoon && natalPoint === "moon" ? 2 : 0;
            const found = findAspect(transits[transit].longitude, natalPosition.longitude, bonus);

            if (!found) {
                continue;
            }

            hits.push({
                transit,
                natal: natalPoint,
                aspect: found.aspect,
                group: ASPECT_GROUP[found.aspect],
                orb: found.orb,
                strength: taper.of(found.orb, found.maxOrb),
            });
        }
    }

    return hits;
}

interface DayResult {
    raw: Record<Key, number>;
    /** Signed contribution per transiting planet, for attributing day-to-day change. */
    byPlanet: Record<Planet, number>;
    /** (sum |v|)^2 / sum v^2 — how many aspects effectively carry the day. */
    effective: number;
}

function scoreDay(transits: TransitChart, natal: NatalChart, taper: Taper, widenMoon: boolean): DayResult {
    const raw = { love: 0, career: 0, health: 0, mood: 0, overall: 0 } as Record<Key, number>;
    const byPlanet = Object.fromEntries(PLANETS.map((p) => [p, 0])) as Record<Planet, number>;

    let absSum = 0;
    let sqSum = 0;

    for (const hit of hitsFor(transits, natal, taper, widenMoon)) {
        const rule = resolveAspectRule(hit);

        if (!rule) {
            continue;
        }

        let total = 0;

        for (const impact of buildImpacts(hit, rule)) {
            raw[impact.area] += impact.value;
            total += impact.value;
        }

        byPlanet[hit.transit] += total;
        absSum += Math.abs(total);
        sqSum += total * total;
    }

    raw.overall = LIFE_AREAS.reduce((sum, area) => sum + AREA_WEIGHTS[area] * raw[area], 0);

    return { raw, byPlanet, effective: sqSum === 0 ? 0 : (absSum * absSum) / sqSum };
}

/* ============================================================
   MEASURE ONE TAPER
============================================================ */

const logit = (score: number) => Math.log(score / (100 - score));
const TARGET = { p10: 38, p90: 74 };

function squashFit(values: number[]): (raw: number) => number {
    const sorted = [...values].sort((a, b) => a - b);
    const p10 = percentile(sorted, 0.1);
    const p90 = percentile(sorted, 0.9);
    const sigma = (p90 - p10) / (logit(TARGET.p90) - logit(TARGET.p10)) || 1;
    const median = p10 - logit(TARGET.p10) * sigma;

    return (raw) => Math.round(Math.max(0, Math.min(100, 100 / (1 + Math.exp(-(raw - median) / sigma)))));
}

function autocorrelation(series: number[], lag: number): number {
    const a = series.slice(0, series.length - lag);
    const b = series.slice(lag);
    const ma = mean(a);
    const mb = mean(b);
    const cov = mean(a.map((v, i) => (v - ma) * (b[i] - mb)));
    const va = mean(a.map((v) => (v - ma) ** 2));
    const vb = mean(b.map((v) => (v - mb) ** 2));

    return cov / (Math.sqrt(va * vb) || 1e-9);
}

/** Direction changes per 30 days: a monotone ramp scores 0, a lively series scores high. */
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

function measure(taper: Taper) {
    const perSubjectRaw = subjects.map((s) => transitCharts.map((t) => scoreDay(t, s.chart, taper, !s.hasBirthTime)));

    const squash = {} as Record<Key, (raw: number) => number>;

    for (const key of KEYS) {
        squash[key] = squashFit(perSubjectRaw.flatMap((days) => days.map((d) => d.raw[key])));
    }

    const scored = perSubjectRaw.map(
        (days) =>
            Object.fromEntries(KEYS.map((key) => [key, days.map((d) => squash[key](d.raw[key]))])) as Record<
                Key,
                number[]
            >
    );

    const deltas = {} as Record<Key, number>;
    const ac1 = {} as Record<Key, number>;
    const turns = {} as Record<Key, number>;

    for (const key of KEYS) {
        deltas[key] = mean(scored.map((s) => mean(s[key].slice(1).map((v, i) => Math.abs(v - s[key][i])))));
        ac1[key] = mean(scored.map((s) => autocorrelation(s[key], 1)));
        turns[key] = mean(scored.map((s) => turningPoints(s[key])));
    }

    const spreads = scored.flatMap((s) =>
        s.love.map((_, i) => {
            const day = LIFE_AREAS.map((area) => s[area][i]);

            return Math.max(...day) - Math.min(...day);
        })
    );

    const effective = mean(perSubjectRaw.flatMap((days) => days.map((d) => d.effective)));

    // How much of the day-to-day change each transiting planet is responsible for.
    const planetShare = Object.fromEntries(PLANETS.map((p) => [p, 0])) as Record<Planet, number>;

    for (const days of perSubjectRaw) {
        for (let i = 1; i < days.length; i++) {
            for (const planet of PLANETS) {
                planetShare[planet] += Math.abs(days[i].byPlanet[planet] - days[i - 1].byPlanet[planet]);
            }
        }
    }

    const shareTotal = Object.values(planetShare).reduce((a, b) => a + b, 0);

    return { deltas, ac1, turns, spreads, effective, planetShare, shareTotal, scored };
}

/* ============================================================
   REPORT
============================================================ */

console.log(`${chartCount} charts x ${dayCount} days\n`);

console.log("how concentrated each taper is (share of an aspect's lifetime contribution)");
console.log("                        within 1 deg   within 2 deg   within half-orb   strength at 3 deg (max 7)");

for (const taper of TAPERS) {
    const samples = Array.from({ length: 7001 }, (_, i) => (i / 1000) * 7);
    const weights = samples.map((orb) => taper.of(orb, 7));
    const total = weights.reduce((a, b) => a + b, 0);
    const within = (deg: number) =>
        (weights.filter((_, i) => samples[i] <= deg).reduce((a, b) => a + b, 0) / total) * 100;

    console.log(
        `  ${taper.label.padEnd(20)}${within(1).toFixed(0).padStart(12)}%${within(2).toFixed(0).padStart(14)}%` +
            `${within(3.5).toFixed(0).padStart(17)}%${taper.of(3, 7).toFixed(2).padStart(24)}`
    );
}

const results = TAPERS.map((taper) => ({ taper, ...measure(taper) }));

console.log("\nday-to-day movement, mean |delta| per area");
console.log("                        love  career  health    mood  overall   effective aspects");

for (const r of results) {
    console.log(
        `  ${r.taper.label.padEnd(20)}` +
            LIFE_AREAS.map((a) => r.deltas[a].toFixed(1).padStart(6)).join("  ") +
            `${r.deltas.overall.toFixed(1).padStart(9)}${r.effective.toFixed(1).padStart(20)}`
    );
}

console.log("\nsmoothness: lag-1 autocorrelation (1.0 = today predicts tomorrow exactly)");
console.log("                        love  career  health    mood  overall");

for (const r of results) {
    console.log(
        `  ${r.taper.label.padEnd(20)}` +
            LIFE_AREAS.map((a) => r.ac1[a].toFixed(2).padStart(6)).join("  ") +
            `${r.ac1.overall.toFixed(2).padStart(9)}`
    );
}

console.log("\nliveliness: direction changes per 30 days (a monotone ramp scores 0)");
console.log("                        love  career  health    mood  overall");

for (const r of results) {
    console.log(
        `  ${r.taper.label.padEnd(20)}` +
            LIFE_AREAS.map((a) => r.turns[a].toFixed(1).padStart(6)).join("  ") +
            `${r.turns.overall.toFixed(1).padStart(9)}`
    );
}

console.log("\nside effects to watch");
console.log("                        area spread median   Moon share of daily change");

for (const r of results) {
    const sorted = [...r.spreads].sort((a, b) => a - b);

    console.log(
        `  ${r.taper.label.padEnd(20)}${percentile(sorted, 0.5).toFixed(0).padStart(17)}` +
            `${((r.planetShare.moon / r.shareTotal) * 100).toFixed(0).padStart(28)}%`
    );
}

console.log("\nwhere today's change comes from, current taper (share of total |delta|)");

const base = results[0];

console.log(
    "  " +
        PLANETS.map((p) => `${p.slice(0, 3)} ${((base.planetShare[p] / base.shareTotal) * 100).toFixed(0)}%`).join("  ")
);

console.log("\nloveScore, one chart, first 15 days");

for (const r of results) {
    console.log(
        `  ${r.taper.label.padEnd(20)}${r.scored[0].love
            .slice(0, 15)
            .map((v) => String(v).padStart(4))
            .join("")}`
    );
}

console.log("\noverallScore, same chart and days");

for (const r of results) {
    console.log(
        `  ${r.taper.label.padEnd(20)}${r.scored[0].overall
            .slice(0, 15)
            .map((v) => String(v).padStart(4))
            .join("")}`
    );
}
