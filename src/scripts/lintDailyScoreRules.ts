/**
 * Coverage and invariant checks for the AspectRule table.
 *
 * A missing rule silently drops an influence — the compatibility module logs a
 * runtime warning for exactly this and nobody sees it. Here it fails a script
 * instead, before the code ships.
 *
 *   pnpm tsx src/scripts/lintDailyScoreRules.ts
 */
import { AspectGroup, LIFE_AREAS, NATAL_POINTS, pairKey, PLANETS } from "../modules/astro";
import { ASPECT_RULES, DIRECTION_OVERRIDES } from "../modules/dailyScore";
import { enumerateRulePairs, isExcludedPair } from "../modules/dailyScore/factors";

const GROUPS: readonly AspectGroup[] = ["conjunction", "harmonious", "challenging"];

const errors: string[] = [];
const warnings: string[] = [];

const index = new Map<string, typeof ASPECT_RULES>();

for (const rule of ASPECT_RULES) {
    const key = `${pairKey(rule.pair[0], rule.pair[1])}|${rule.group}`;

    index.set(key, [...(index.get(key) ?? []), rule]);
}

/* ============================================================
   1. COVERAGE
============================================================ */

const pairs = enumerateRulePairs(NATAL_POINTS, PLANETS);

for (const [a, b] of pairs) {
    for (const group of GROUPS) {
        const found = index.get(`${pairKey(a, b)}|${group}`);

        if (!found) {
            errors.push(`missing rule: ${a}-${b} ${group}`);
        } else if (found.length > 1) {
            errors.push(`duplicate rule: ${a}-${b} ${group} (${found.length} entries)`);
        }
    }
}

const expected = pairs.length * GROUPS.length;

if (ASPECT_RULES.length !== expected) {
    errors.push(`rule count ${ASPECT_RULES.length}, expected ${expected}`);
}

/* ============================================================
   2. PER-RULE INVARIANTS
============================================================ */

for (const rule of ASPECT_RULES) {
    const label = `${rule.pair[0]}-${rule.pair[1]} ${rule.group}`;

    const [a, b] = rule.pair;
    const sorted = [a, b].slice().sort();

    if (a !== sorted[0] || b !== sorted[1]) {
        errors.push(`${label}: pair is not canonically sorted`);
    }

    if (isExcludedPair(a, b)) {
        errors.push(`${label}: pair is excluded (outer-to-outer) but has a rule`);
    }

    if (Math.abs(rule.baseImpact) > 10) {
        errors.push(`${label}: |baseImpact| ${rule.baseImpact} exceeds 10`);
    }

    if (rule.importance < 1 || rule.importance > 2) {
        errors.push(`${label}: importance ${rule.importance} outside [1, 2]`);
    }

    if (!Number.isInteger(rule.priority) || rule.priority < 1 || rule.priority > 5) {
        errors.push(`${label}: priority ${rule.priority} is not an integer in 1..5`);
    }

    const areaSum = LIFE_AREAS.reduce((sum, area) => sum + (rule.areas[area] ?? 0), 0);

    if (Math.abs(areaSum - 1) > 1e-9) {
        errors.push(`${label}: areas sum to ${areaSum}, expected 1`);
    }

    for (const area of LIFE_AREAS) {
        const share = rule.areas[area];

        if (share !== undefined && (share <= 0 || share > 1)) {
            errors.push(`${label}: area ${area} share ${share} outside (0, 1]`);
        }
    }

    if (!rule.title.trim() || !rule.description.trim()) {
        errors.push(`${label}: empty title or description`);
    }

    // A rule that cannot move the score is almost certainly an unfinished draft.
    if (Math.abs(rule.baseImpact) < 1) {
        warnings.push(`${label}: baseImpact ${rule.baseImpact} is effectively inert`);
    }
}

/* ============================================================
   3. CROSS-RULE SEMANTICS
============================================================ */

for (const [a, b] of pairs) {
    const harmonious = index.get(`${pairKey(a, b)}|harmonious`)?.[0];
    const challenging = index.get(`${pairKey(a, b)}|challenging`)?.[0];

    if (!harmonious || !challenging) {
        continue;
    }

    if (challenging.baseImpact > harmonious.baseImpact) {
        errors.push(
            `${a}-${b}: challenging (${challenging.baseImpact}) scores higher than harmonious (${harmonious.baseImpact})`
        );
    }

    if (harmonious.baseImpact < 0) {
        warnings.push(`${a}-${b}: harmonious baseImpact is negative (${harmonious.baseImpact})`);
    }

    if (challenging.baseImpact > 0) {
        warnings.push(`${a}-${b}: challenging baseImpact is positive (${challenging.baseImpact})`);
    }
}

/* ============================================================
   4. OVERRIDES
============================================================ */

for (const override of DIRECTION_OVERRIDES) {
    const label = `override ${override.transit}>${override.natal} ${override.group}`;

    if (!index.has(`${pairKey(override.transit, override.natal)}|${override.group}`)) {
        errors.push(`${label}: no base rule for this pair and group`);
    }

    if (isExcludedPair(override.transit, override.natal)) {
        errors.push(`${label}: pair is excluded`);
    }

    if (override.areas) {
        const areaSum = LIFE_AREAS.reduce((sum, area) => sum + (override.areas?.[area] ?? 0), 0);

        if (Math.abs(areaSum - 1) > 1e-9) {
            errors.push(`${label}: areas sum to ${areaSum}, expected 1`);
        }
    }
}

/* ============================================================
   REPORT
============================================================ */

console.log(`rules: ${ASPECT_RULES.length}  pairs: ${pairs.length}  overrides: ${DIRECTION_OVERRIDES.length}`);

for (const warning of warnings) {
    console.warn(`  WARN  ${warning}`);
}

for (const error of errors) {
    console.error(`  FAIL  ${error}`);
}

console.log(`\n${errors.length} errors, ${warnings.length} warnings`);

if (errors.length > 0) {
    process.exit(1);
}
