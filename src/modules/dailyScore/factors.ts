import { AspectType, Layer, LifeArea, NatalPoint, OUTER_PLANETS, pairKey, Planet } from "../astro";

/* ============================================================
   MULTIPLIERS
============================================================ */

/**
 * Separates trine from sextile inside the "harmonious" group, and square from
 * opposition inside "challenging", so rules stay keyed on 3 groups instead of 5
 * aspects.
 */
export const ASPECT_STRENGTH: Record<AspectType, number> = {
    conjunction: 1.0,
    square: 1.0,
    trine: 0.95,
    opposition: 0.9,
    sextile: 0.8,
};

/**
 * The single owner of "how much of the score's level comes from the current
 * chapter versus from today".
 *
 * Slow transits sit well below 1 deliberately. Their significance is already
 * expressed by persistence — a Saturn aspect shows up in forty consecutive daily
 * scores — so weighting them up as well would count duration twice.
 *
 * Lowered from 0.6 to 0.35 as a product decision: a daily score should read like a
 * forecast rather than a trend. This is the only lever that survives recalibration,
 * because it changes the RATIO of fast variation to slow level rather than the
 * overall scale — anything that merely scales an area's raw values gets absorbed
 * when sigma is refitted.
 *
 * The cost, accepted knowingly: a hard Saturn period no longer shows up as a
 * sustained stretch of low scores.
 */
export const LAYER_GAIN: Record<Layer, number> = {
    fast: 1.0,
    slow: 0.35,
};

/**
 * Artefact of sampling transits once per day.
 *
 * The Moon crosses a full orb within a day (~13.2°/day), so a single midnight
 * sample is a noisy estimate of its influence; every other body is effectively
 * static across the day. This is a variance correction, NOT a statement that the
 * Moon matters less. When intraday sampling lands (peak hours), it goes to 1.0
 * and this table disappears.
 */
export const SAMPLING_PENALTY: Partial<Record<Planet, number>> = {
    moon: 0.85,
};

/** Weights for deriving the overall raw sum. Applied to raw values, not to squashed scores. */
export const AREA_WEIGHTS: Record<LifeArea, number> = {
    love: 0.3,
    career: 0.3,
    health: 0.2,
    mood: 0.2,
};

/* ============================================================
   COVERAGE
============================================================ */

/**
 * Uranus/Neptune/Pluto aspecting each other is generational — a whole birth
 * cohort shares it, so it consumes rules without personalising anything.
 */
export function isExcludedPair(a: NatalPoint, b: NatalPoint): boolean {
    return OUTER_PLANETS.includes(a as Planet) && OUTER_PLANETS.includes(b as Planet);
}

/**
 * Every unordered pair a rule table has to cover. The Ascendant is only ever a
 * natal point, so {ascendant, ascendant} is unreachable.
 *
 * 59 pairs × 3 groups = 177 rules.
 */
export function enumerateRulePairs(
    points: readonly NatalPoint[],
    planets: readonly Planet[]
): [NatalPoint, NatalPoint][] {
    const seen = new Set<string>();
    const pairs: [NatalPoint, NatalPoint][] = [];

    for (const transit of planets) {
        for (const natal of points) {
            if (isExcludedPair(transit, natal)) {
                continue;
            }

            const key = pairKey(transit, natal);

            if (seen.has(key)) {
                continue;
            }

            seen.add(key);

            const [a, b] = [transit, natal].sort() as [NatalPoint, NatalPoint];

            pairs.push([a, b]);
        }
    }

    return pairs;
}
