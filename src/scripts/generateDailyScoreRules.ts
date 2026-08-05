/**
 * SPENT. Bootstrap tool, kept for reference — do NOT run this again.
 *
 * It produced the first complete draft of all 177 rules so the engine ran end to
 * end with no gaps. That job is done. From that point on the source of truth is
 * src/modules/dailyScore/rules.ts, which now carries hand-authored astrology that
 * a re-run would silently destroy.
 *
 * The priors below are a factorised model — the approach that was deliberately
 * rejected for the runtime. It was fine here, where being approximate was the
 * point, and it is not fine as a source of truth.
 *
 * If the table ever genuinely needs rebuilding from scratch, read rules.ts first
 * and port the hand-authored values back into these priors.
 */
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { AspectGroup, LIFE_AREAS, LifeArea, NatalPoint, NATAL_POINTS, PLANETS } from "../modules/astro";
import { enumerateRulePairs } from "../modules/dailyScore/factors";
import { AspectRule } from "../modules/dailyScore/types";

/* ============================================================
   PRIORS — draft only, hand-tuned afterwards in rules.ts
============================================================ */

interface PointPrior {
    /** How easy the point's energy is to live with. −1 hard, +1 easy. Drives conjunction polarity. */
    harmony: number;
    /** How much a hit on this point matters. */
    weight: number;
    /** Which areas of life it governs. Relative, normalised later. */
    domains: Record<LifeArea, number>;
    keyword: string;
    display: string;
}

const POINT_PRIORS: Record<NatalPoint, PointPrior> = {
    sun: {
        harmony: 0.4,
        weight: 1.3,
        domains: { love: 0.15, career: 0.35, health: 0.22, mood: 0.28 },
        keyword: "identity and vitality",
        display: "Sun",
    },
    moon: {
        harmony: 0.2,
        weight: 1.3,
        // Sleep, digestion and bodily rhythm are lunar — the draft under-served health.
        domains: { love: 0.25, career: 0.05, health: 0.28, mood: 0.42 },
        keyword: "feelings and instinct",
        display: "Moon",
    },
    mercury: {
        harmony: 0.2,
        weight: 0.95,
        domains: { love: 0.2, career: 0.36, health: 0.16, mood: 0.28 },
        keyword: "thinking and communication",
        display: "Mercury",
    },
    venus: {
        harmony: 0.8,
        weight: 1.05,
        // Rest and indulgence are Venusian; health cannot be a Mars-only story.
        domains: { love: 0.5, career: 0.1, health: 0.2, mood: 0.2 },
        keyword: "affection and pleasure",
        display: "Venus",
    },
    mars: {
        harmony: -0.3,
        weight: 1.0,
        // Still the largest single source of physical energy, no longer nearly the only one.
        domains: { love: 0.22, career: 0.34, health: 0.26, mood: 0.18 },
        keyword: "drive and assertion",
        display: "Mars",
    },
    jupiter: {
        harmony: 0.7,
        weight: 0.85,
        domains: { love: 0.2, career: 0.35, health: 0.2, mood: 0.25 },
        keyword: "growth and optimism",
        display: "Jupiter",
    },
    saturn: {
        harmony: -0.6,
        weight: 0.9,
        domains: { love: 0.1, career: 0.4, health: 0.25, mood: 0.25 },
        keyword: "structure and limits",
        display: "Saturn",
    },
    uranus: {
        harmony: -0.2,
        weight: 0.7,
        domains: { love: 0.25, career: 0.3, health: 0.15, mood: 0.3 },
        keyword: "disruption and independence",
        display: "Uranus",
    },
    neptune: {
        harmony: -0.15,
        weight: 0.7,
        domains: { love: 0.3, career: 0.1, health: 0.2, mood: 0.4 },
        keyword: "imagination and blurred edges",
        display: "Neptune",
    },
    pluto: {
        harmony: -0.45,
        weight: 0.75,
        domains: { love: 0.25, career: 0.25, health: 0.2, mood: 0.3 },
        keyword: "intensity and transformation",
        display: "Pluto",
    },
    ascendant: {
        harmony: 0.1,
        weight: 1.2,
        domains: { love: 0.15, career: 0.2, health: 0.35, mood: 0.3 },
        keyword: "how you show up",
        display: "Ascendant",
    },
};

const GROUPS: readonly AspectGroup[] = ["conjunction", "harmonious", "challenging"];

/* ============================================================
   DERIVATION
============================================================ */

function round1(value: number): number {
    return Math.round(value * 10) / 10;
}

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

/** Blend both points' domains and force the result to sum to exactly 1 at 2 decimals. */
function deriveAreas(a: NatalPoint, b: NatalPoint): Partial<Record<LifeArea, number>> {
    const blended = LIFE_AREAS.map((area) => ({
        area,
        value: (POINT_PRIORS[a].domains[area] + POINT_PRIORS[b].domains[area]) / 2,
    }));

    const total = blended.reduce((sum, entry) => sum + entry.value, 0);

    const buckets = blended.map((entry) => ({
        area: entry.area,
        units: Math.round((entry.value / total) * 100),
    }));

    // Hand the rounding residual to the largest buckets, in fixed area order on ties.
    let residual = 100 - buckets.reduce((sum, bucket) => sum + bucket.units, 0);

    const byMagnitude = [...buckets].sort(
        (x, y) => y.units - x.units || LIFE_AREAS.indexOf(x.area) - LIFE_AREAS.indexOf(y.area)
    );

    let cursor = 0;

    while (residual !== 0) {
        const step = residual > 0 ? 1 : -1;

        byMagnitude[cursor % byMagnitude.length].units += step;
        residual -= step;
        cursor++;
    }

    const areas: Partial<Record<LifeArea, number>> = {};

    for (const area of LIFE_AREAS) {
        const bucket = buckets.find((candidate) => candidate.area === area);

        if (bucket && bucket.units > 0) {
            areas[area] = bucket.units / 100;
        }
    }

    return areas;
}

function deriveImportance(a: NatalPoint, b: NatalPoint): number {
    const pairWeight = (POINT_PRIORS[a].weight + POINT_PRIORS[b].weight) / 2;

    return round2(Math.min(2, Math.max(1, 0.5 + pairWeight)));
}

function deriveBaseImpact(a: NatalPoint, b: NatalPoint, group: AspectGroup): number {
    const pairWeight = (POINT_PRIORS[a].weight + POINT_PRIORS[b].weight) / 2;
    const harmony = (POINT_PRIORS[a].harmony + POINT_PRIORS[b].harmony) / 2;

    const magnitude = 4 + 4 * pairWeight;

    if (group === "harmonious") {
        return round1(magnitude * (0.7 + 0.3 * harmony));
    }

    if (group === "challenging") {
        return round1(-magnitude * (0.7 - 0.3 * harmony));
    }

    // A conjunction's polarity is the pair's own nature, never a planet's global label.
    // Thematically neutral pairs land near zero on purpose: intense, but not good or bad.
    return round1(magnitude * Math.max(-1, Math.min(1, harmony * 1.3)));
}

/** Quintile cuts of the observed spread, so the draft always uses the full 1–5 range. */
function quintileThresholds(values: number[]): [number, number, number, number] {
    const sorted = [...values].sort((x, y) => x - y);
    const at = (fraction: number) => sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];

    return [at(0.2), at(0.4), at(0.6), at(0.8)];
}

/** Narrative interest, decoupled from magnitude — a score-neutral conjunction can still be the story. */
function derivePriority(
    a: NatalPoint,
    b: NatalPoint,
    group: AspectGroup,
    baseImpact: number,
    importance: number,
    thresholds: [number, number, number, number]
): number {
    const product = Math.abs(baseImpact) * importance;

    let priority = 1;

    for (const threshold of thresholds) {
        if (product >= threshold) {
            priority++;
        }
    }

    priority = Math.min(5, priority);

    // Conjunctions to the personal points read as events even when they score flat.
    const personal: NatalPoint[] = ["sun", "moon", "ascendant"];

    if (group === "conjunction" && (personal.includes(a) || personal.includes(b))) {
        priority = Math.min(5, priority + 1);
    }

    return priority;
}

function deriveText(a: NatalPoint, b: NatalPoint, group: AspectGroup): { title: string; description: string } {
    const priorA = POINT_PRIORS[a];
    const priorB = POINT_PRIORS[b];
    const samePoint = a === b;

    if (group === "harmonious") {
        return {
            title: samePoint
                ? `${priorA.display} in easy flow`
                : `${priorA.display} and ${priorB.display} flow together`,
            description: samePoint
                ? `Today ${priorA.keyword} settles into a comfortable rhythm.`
                : `Today ${priorA.keyword} supports ${priorB.keyword} without friction.`,
        };
    }

    if (group === "challenging") {
        return {
            title: samePoint ? `${priorA.display} under strain` : `${priorA.display} and ${priorB.display} pull apart`,
            description: samePoint
                ? `Today ${priorA.keyword} works against itself and needs a deliberate choice.`
                : `Today ${priorA.keyword} runs into ${priorB.keyword}, and the tension asks for a deliberate choice.`,
        };
    }

    return {
        title: samePoint ? `${priorA.display} returns` : `${priorA.display} meets ${priorB.display}`,
        description: samePoint
            ? `Today ${priorA.keyword} comes back into sharp focus.`
            : `Today ${priorA.keyword} and ${priorB.keyword} fuse into a single, concentrated theme.`,
    };
}

/* ============================================================
   EMIT
============================================================ */

const pairs = enumerateRulePairs(NATAL_POINTS, PLANETS);

const drafts: { pair: [NatalPoint, NatalPoint]; group: AspectGroup; baseImpact: number; importance: number }[] = [];

for (const [a, b] of pairs) {
    for (const group of GROUPS) {
        drafts.push({
            pair: [a, b],
            group,
            baseImpact: deriveBaseImpact(a, b, group),
            importance: deriveImportance(a, b),
        });
    }
}

const thresholds = quintileThresholds(drafts.map((draft) => Math.abs(draft.baseImpact) * draft.importance));

const rules: AspectRule[] = drafts.map((draft) => {
    const [a, b] = draft.pair;

    return {
        ...draft,
        areas: deriveAreas(a, b),
        priority: derivePriority(a, b, draft.group, draft.baseImpact, draft.importance, thresholds),
        ...deriveText(a, b, draft.group),
    };
});

const target = join(import.meta.dirname, "..", "modules", "dailyScore", "rules.ts");

if (existsSync(target) && !process.argv.includes("--i-know-this-destroys-hand-authored-rules")) {
    console.error(`This generator is spent. ${target} is now the source of truth and`);
    console.error("contains hand-authored astrology that regenerating would destroy.");
    console.error("Read the header of this file before considering it.");
    process.exit(1);
}

const body = rules
    .map((rule) => {
        const areas = Object.entries(rule.areas)
            .map(([area, weight]) => `${area}: ${weight}`)
            .join(", ");

        return `    {
        pair: ["${rule.pair[0]}", "${rule.pair[1]}"],
        group: "${rule.group}",
        baseImpact: ${rule.baseImpact},
        importance: ${rule.importance},
        areas: { ${areas} },
        priority: ${rule.priority},
        title: ${JSON.stringify(rule.title)},
        description: ${JSON.stringify(rule.description)},
    },`;
    })
    .join("\n");

const file = `import { AspectRule } from "./types";

/**
 * DRAFT — generated by src/scripts/generateDailyScoreRules.ts.
 *
 * Every (pair, group) combination is covered so no influence is ever silently
 * dropped. The numbers are priors and the texts are templated; both are meant to
 * be hand-tuned from the highest-priority pairs downwards.
 *
 * Regenerating overwrites hand tuning — the generator refuses without --force.
 *
 * Invariants are enforced by src/scripts/lintDailyScoreRules.ts.
 */
export const ASPECT_RULES: AspectRule[] = [
${body}
];
`;

writeFileSync(target, file, "utf8");

const positives = rules.filter((rule) => rule.baseImpact > 0).length;
const negatives = rules.filter((rule) => rule.baseImpact < 0).length;

console.log(`Wrote ${rules.length} rules for ${pairs.length} pairs to ${target}`);
console.log(`  positive: ${positives}  negative: ${negatives}  neutral: ${rules.length - positives - negatives}`);
console.log(
    `  |baseImpact| range: ${Math.min(...rules.map((r) => Math.abs(r.baseImpact))).toFixed(1)}` +
        ` – ${Math.max(...rules.map((r) => Math.abs(r.baseImpact))).toFixed(1)}`
);
console.log(
    `  priority spread: ${[1, 2, 3, 4, 5].map((p) => `${p}:${rules.filter((r) => r.priority === p).length}`).join("  ")}`
);
