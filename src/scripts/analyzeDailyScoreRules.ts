/**
 * Where the daily score actually comes from.
 *
 * Ranks rules by total influence (occurrences x mean |contribution|) so tuning
 * starts with the rules that move most scores, and reports which transiting
 * planets and natal points feed each life area — the diagnostic for area skew.
 *
 *   pnpm tsx src/scripts/analyzeDailyScoreRules.ts [--charts 200] [--days 365]
 *   pnpm tsx src/scripts/analyzeDailyScoreRules.ts --rule saturn-moon
 *   pnpm tsx src/scripts/analyzeDailyScoreRules.ts --top 40
 *
 * Uses the same seeded sample as the calibration, so the numbers describe the
 * engine as calibrated.
 */
import {
    AspectGroup,
    AspectType,
    findTransitToNatalAspects,
    LIFE_AREAS,
    LifeArea,
    NatalPoint,
    NATAL_POINTS,
    pairKey,
    Planet,
    PLANETS,
} from "../modules/astro";
import { buildImpacts, calculateDailyScore, resolveAspectRule } from "../modules/dailyScore";
import { argValue, buildSample, mean, median, percentile, round2 } from "./sampling";

interface RuleStats {
    pair: [NatalPoint, NatalPoint];
    group: AspectGroup;
    baseImpact: number;
    importance: number;
    priority: number;
    /** Signed total contribution per occurrence (== the rule's magnitude for that hit). */
    totals: number[];
    subjects: Set<number>;
    byAspect: Map<AspectType, number>;
    byDirection: Map<string, { count: number; sum: number }>;
}

type Flow = { positive: number; negative: number };

const chartCount = argValue("charts", 200);
const dayCount = argValue("days", 365);
const topCount = argValue("top", 30);
const ruleFilter = (() => {
    const index = process.argv.indexOf("--rule");

    return index === -1 ? null : process.argv[index + 1];
})();

const { subjects, transitCharts } = buildSample(chartCount, dayCount);
const dayTotal = chartCount * dayCount;

console.log(`${chartCount} charts x ${dayCount} days = ${dayTotal.toLocaleString("en-US")} user-days\n`);

/* ============================================================
   COLLECT
============================================================ */

const rules = new Map<string, RuleStats>();

const areaByTransit = {} as Record<LifeArea, Record<Planet, Flow>>;
const areaByNatal = {} as Record<LifeArea, Record<NatalPoint, Flow>>;

for (const area of LIFE_AREAS) {
    areaByTransit[area] = Object.fromEntries(PLANETS.map((planet) => [planet, { positive: 0, negative: 0 }])) as Record<
        Planet,
        Flow
    >;
    areaByNatal[area] = Object.fromEntries(
        NATAL_POINTS.map((point) => [point, { positive: 0, negative: 0 }])
    ) as Record<NatalPoint, Flow>;
}

const rawByArea: Record<LifeArea, number[]> = { love: [], career: [], health: [], mood: [] };
const scoreByArea: Record<LifeArea, number[]> = { love: [], career: [], health: [], mood: [] };
const maxCounts: Record<LifeArea, number> = { love: 0, career: 0, health: 0, mood: 0 };
const tiedShare: Record<LifeArea, number> = { love: 0, career: 0, health: 0, mood: 0 };
/** Can this area ever be good news on its own terms, regardless of the other three? */
const goodNews: Record<LifeArea, number> = { love: 0, career: 0, health: 0, mood: 0 };

let tiedDays = 0;

/**
 * Per transiting planet: how much of its contribution is movement over time
 * versus a constant offset for that particular user.
 *
 * A body whose contribution barely changes across a year is not producing daily
 * astrology — it is producing a per-user bias, and a population-wide calibration
 * cannot remove it.
 */
const perSubjectMean: Record<Planet, number[]> = Object.fromEntries(
    PLANETS.map((planet) => [planet, [] as number[]])
) as Record<Planet, number[]>;

const perSubjectSpread: Record<Planet, number[]> = Object.fromEntries(
    PLANETS.map((planet) => [planet, [] as number[]])
) as Record<Planet, number[]>;

for (const [subjectIndex, subject] of subjects.entries()) {
    const series: Record<Planet, number[]> = Object.fromEntries(
        PLANETS.map((planet) => [planet, [] as number[]])
    ) as Record<Planet, number[]>;

    for (const transits of transitCharts) {
        const hits = findTransitToNatalAspects(transits, subject.chart, {
            widenNatalMoon: !subject.hasBirthTime,
        });

        const dailyByPlanet: Record<Planet, number> = Object.fromEntries(
            PLANETS.map((planet) => [planet, 0])
        ) as Record<Planet, number>;

        for (const hit of hits) {
            const rule = resolveAspectRule(hit);

            if (!rule) {
                continue;
            }

            const impacts = buildImpacts(hit, rule);
            const total = impacts.reduce((sum, impact) => sum + impact.value, 0);

            dailyByPlanet[hit.transit] += total;

            const key = `${pairKey(rule.pair[0], rule.pair[1])}|${rule.group}`;

            let stats = rules.get(key);

            if (!stats) {
                stats = {
                    pair: rule.pair,
                    group: rule.group,
                    baseImpact: rule.baseImpact,
                    importance: rule.importance,
                    priority: rule.priority,
                    totals: [],
                    subjects: new Set(),
                    byAspect: new Map(),
                    byDirection: new Map(),
                };

                rules.set(key, stats);
            }

            stats.totals.push(total);
            stats.subjects.add(subjectIndex);
            stats.byAspect.set(hit.aspect, (stats.byAspect.get(hit.aspect) ?? 0) + 1);

            const directionKey = `${hit.transit}>${hit.natal}`;
            const direction = stats.byDirection.get(directionKey) ?? { count: 0, sum: 0 };

            direction.count++;
            direction.sum += total;
            stats.byDirection.set(directionKey, direction);

            for (const impact of impacts) {
                const transitFlow = areaByTransit[impact.area][impact.transit];
                const natalFlow = areaByNatal[impact.area][impact.natal];

                if (impact.value >= 0) {
                    transitFlow.positive += impact.value;
                    natalFlow.positive += impact.value;
                } else {
                    transitFlow.negative += impact.value;
                    natalFlow.negative += impact.value;
                }
            }
        }

        for (const planet of PLANETS) {
            series[planet].push(dailyByPlanet[planet]);
        }

        const result = calculateDailyScore({
            natal: subject.chart,
            transits,
            hasBirthTime: subject.hasBirthTime,
        });

        const scores: Record<LifeArea, number> = {
            love: result.scores.loveScore,
            career: result.scores.careerScore,
            health: result.scores.healthScore,
            mood: result.scores.moodScore,
        };

        for (const area of LIFE_AREAS) {
            rawByArea[area].push(result.raw[area]);
            scoreByArea[area].push(scores[area]);

            if (scores[area] >= 70) {
                goodNews[area]++;
            }
        }

        // Scores are integers and the areas are strongly correlated, so ties are
        // common. Breaking them by iteration order would invent a bias that looks
        // exactly like a real one — count them separately instead.
        const best = Math.max(...LIFE_AREAS.map((area) => scores[area]));
        const winners = LIFE_AREAS.filter((area) => scores[area] === best);

        if (winners.length === 1) {
            maxCounts[winners[0]]++;
        } else {
            tiedDays++;

            for (const area of winners) {
                tiedShare[area]++;
            }
        }
    }

    for (const planet of PLANETS) {
        const values = series[planet];
        const average = mean(values);

        perSubjectMean[planet].push(average);
        perSubjectSpread[planet].push(Math.sqrt(mean(values.map((value) => (value - average) ** 2))));
    }
}

/* ============================================================
   1. SINGLE-RULE DETAIL
============================================================ */

if (ruleFilter) {
    const [a, b] = ruleFilter.split("-");
    const wanted = pairKey(a as NatalPoint, b as NatalPoint);

    for (const group of ["conjunction", "harmonious", "challenging"] as AspectGroup[]) {
        const stats = rules.get(`${wanted}|${group}`);

        if (!stats) {
            console.log(`${wanted} ${group}: never occurred in the sample\n`);
            continue;
        }

        const absolute = stats.totals.map((value) => Math.abs(value));

        console.log(`${stats.pair[0]} - ${stats.pair[1]}  ${group}`);
        console.log(`  baseImpact ${stats.baseImpact}  importance ${stats.importance}  priority ${stats.priority}`);
        console.log(`  occurrences:     ${stats.totals.length.toLocaleString("en-US")}`);
        console.log(
            `  per user-day:    ${((stats.totals.length / dayTotal) * 100).toFixed(2)}%` +
                `   affected users: ${((stats.subjects.size / chartCount) * 100).toFixed(0)}%`
        );
        console.log(`  mean impact:     ${mean(stats.totals) >= 0 ? "+" : ""}${mean(stats.totals).toFixed(2)}`);
        console.log(`  median impact:   ${median(stats.totals) >= 0 ? "+" : ""}${median(stats.totals).toFixed(2)}`);
        console.log(`  mean |impact|:   ${mean(absolute).toFixed(2)}   max ${Math.max(...absolute).toFixed(2)}`);
        console.log(
            `  by aspect:       ${[...stats.byAspect.entries()]
                .sort((x, y) => y[1] - x[1])
                .map(([aspect, count]) => `${aspect} ${count}`)
                .join("  ")}`
        );
        console.log(
            `  by direction:    ${[...stats.byDirection.entries()]
                .sort((x, y) => y[1].count - x[1].count)
                .map(([label, value]) => `${label} ${value.count} (avg ${(value.sum / value.count).toFixed(2)})`)
                .join("  ")}`
        );
        console.log();
    }

    process.exit(0);
}

/* ============================================================
   2. RULES BY INFLUENCE
============================================================ */

const ranked = [...rules.entries()]
    .map(([key, stats]) => {
        const absolute = stats.totals.map((value) => Math.abs(value));

        return {
            key,
            stats,
            occurrences: stats.totals.length,
            influence: absolute.reduce((sum, value) => sum + value, 0),
            meanImpact: mean(stats.totals),
            meanAbsolute: mean(absolute),
        };
    })
    .sort((x, y) => y.influence - x.influence);

const grandInfluence = ranked.reduce((sum, entry) => sum + entry.influence, 0);

console.log(`rules that occurred: ${ranked.length} of 177\n`);
console.log(`top ${topCount} rules by influence (occurrences x mean |impact|)`);
console.log("   #  rule                              group        occur   %days  users   mean   |mean|   cum%");

let cumulative = 0;

for (const [index, entry] of ranked.slice(0, topCount).entries()) {
    cumulative += entry.influence;

    const label = `${entry.stats.pair[0]}-${entry.stats.pair[1]}`;

    console.log(
        `  ${String(index + 1).padStart(2)}  ${label.padEnd(32)}  ${entry.stats.group.padEnd(11)}` +
            `${String(entry.occurrences).padStart(7)}` +
            `${((entry.occurrences / dayTotal) * 100).toFixed(1).padStart(7)}%` +
            `${((entry.stats.subjects.size / chartCount) * 100).toFixed(0).padStart(5)}%` +
            `${(entry.meanImpact >= 0 ? "+" : "") + entry.meanImpact.toFixed(2).padStart(6)}` +
            `${entry.meanAbsolute.toFixed(2).padStart(8)}` +
            `${((cumulative / grandInfluence) * 100).toFixed(0).padStart(7)}%`
    );
}

const eighty = ranked.findIndex((entry, index) => {
    const share = ranked.slice(0, index + 1).reduce((sum, item) => sum + item.influence, 0) / grandInfluence;

    return share >= 0.8;
});

console.log(`\n  ${eighty + 1} rules carry 80% of all influence.`);

/* ============================================================
   3. INERT BUT FREQUENT
============================================================ */

const inert = ranked
    .filter((entry) => Math.abs(entry.stats.baseImpact) < 1.5)
    .sort((x, y) => y.occurrences - x.occurrences);

if (inert.length > 0) {
    console.log(`\nnear-inert rules (|baseImpact| < 1.5), most frequent first — top tuning targets`);
    console.log("      rule                          group        occur   %days   mean");

    for (const entry of inert.slice(0, 12)) {
        const label = `${entry.stats.pair[0]}-${entry.stats.pair[1]}`;

        console.log(
            `      ${label.padEnd(28)}  ${entry.stats.group.padEnd(11)}` +
                `${String(entry.occurrences).padStart(7)}` +
                `${((entry.occurrences / dayTotal) * 100).toFixed(1).padStart(7)}%` +
                `${(entry.meanImpact >= 0 ? "+" : "") + entry.meanImpact.toFixed(2).padStart(6)}` +
                `   baseImpact ${entry.stats.baseImpact}`
        );
    }
}

/* ============================================================
   4. WHERE EACH AREA'S ENERGY COMES FROM
============================================================ */

function flowTable<K extends string>(
    title: string,
    keys: readonly K[],
    source: Record<LifeArea, Record<K, Flow>>
): void {
    console.log(`\n${title}`);
    console.log(`  ${"".padEnd(11)}${LIFE_AREAS.map((area) => area.padStart(16)).join("")}`);

    for (const key of keys) {
        const cells = LIFE_AREAS.map((area) => {
            const flow = source[area][key];
            const areaTotal = keys.reduce(
                (sum, candidate) => sum + source[area][candidate].positive + Math.abs(source[area][candidate].negative),
                0
            );
            const share = ((flow.positive + Math.abs(flow.negative)) / areaTotal) * 100;
            const net = flow.positive + flow.negative;

            return `${share.toFixed(1).padStart(6)}% ${(net >= 0 ? "+" : "") + (net / dayTotal).toFixed(2).padStart(6)}`;
        });

        console.log(`  ${key.padEnd(11)}${cells.join(" ")}`);
    }

    console.log("  (share of total |contribution| in that area, then net contribution per user-day)");
}

flowTable("energy by TRANSITING planet", PLANETS, areaByTransit);
flowTable("energy by NATAL point", NATAL_POINTS, areaByNatal);

/* ============================================================
   5. AREA BALANCE
============================================================ */

console.log("\narea balance");
console.log("            raw mean  raw p10  raw p90  raw range   score mean   sole highest   in a tie   reaches 70+");

const uniqueDays = dayTotal - tiedDays;

for (const area of LIFE_AREAS) {
    const sortedRaw = [...rawByArea[area]].sort((a, b) => a - b);
    const range = percentile(sortedRaw, 0.9) - percentile(sortedRaw, 0.1);

    console.log(
        `  ${area.padEnd(9)}` +
            `${mean(rawByArea[area]).toFixed(2).padStart(9)}` +
            `${percentile(sortedRaw, 0.1).toFixed(2).padStart(9)}` +
            `${percentile(sortedRaw, 0.9).toFixed(2).padStart(9)}` +
            `${range.toFixed(2).padStart(11)}` +
            `${mean(scoreByArea[area]).toFixed(1).padStart(13)}` +
            `${((maxCounts[area] / Math.max(1, uniqueDays)) * 100).toFixed(1).padStart(15)}%` +
            `${((tiedShare[area] / Math.max(1, tiedDays)) * 100).toFixed(1).padStart(11)}%` +
            `${((goodNews[area] / dayTotal) * 100).toFixed(1).padStart(13)}%`
    );
}

console.log(
    `\n  ${((tiedDays / dayTotal) * 100).toFixed(1)}% of user-days have two or more areas tied for highest` +
        ` — excluded from "sole highest"`
);
console.log(`  a balanced table would show ~25% in both of the last two columns`);

/* ============================================================
   6. DAILY SIGNAL VS PER-USER BIAS
============================================================ */

console.log("\ntimescale: is this planet producing daily variation or a constant per-user offset?");
console.log("             within-user   between-user   ratio   mean offset   verdict");

for (const planet of PLANETS) {
    const within = mean(perSubjectSpread[planet]);
    const betweenMean = mean(perSubjectMean[planet]);
    const between = Math.sqrt(mean(perSubjectMean[planet].map((value) => (value - betweenMean) ** 2)));

    const ratio = within / (between || 1e-9);

    const verdict = ratio > 3 ? "daily signal" : ratio > 1 ? "mixed" : "per-user bias";

    console.log(
        `  ${planet.padEnd(9)}` +
            `${within.toFixed(2).padStart(12)}` +
            `${between.toFixed(2).padStart(15)}` +
            `${ratio.toFixed(1).padStart(8)}` +
            `${betweenMean.toFixed(2).padStart(14)}` +
            `   ${verdict}`
    );
}

console.log("  within-user  = how much its contribution moves across the sampled window");
console.log("  between-user = how much its average differs from one user to the next");
console.log("  a low ratio means the body mostly shifts a user's baseline rather than their day");

const skew = LIFE_AREAS.map((area) => {
    const values = rawByArea[area];
    const m = mean(values);
    const sd = Math.sqrt(mean(values.map((value) => (value - m) ** 2)));

    return { area, skew: round2((m - median(values)) / (sd || 1)) };
});

console.log(`  raw skew (mean-median)/sd:  ${skew.map((entry) => `${entry.area} ${entry.skew}`).join("   ")}`);
