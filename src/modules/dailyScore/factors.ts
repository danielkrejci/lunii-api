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
 * The same argument applies to `weekly`, and for a long time it was missed. Sun,
 * Mercury, Venus and Mars move 0.5–1.4°/day, so within a 7–8° orb one aspect holds
 * for 10–20 days; grouped with the Moon at gain 1.0 they contributed 72 % of the
 * score's movement while being incapable of moving it overnight. Measured
 * consequence: lag-1 autocorrelation of the raw sum was 0.82 (career 0.90), and 28
 * of 100 sampled charts had a week averaging under 25 with a spread under 15
 * points — a flat low week, which is what the score looked like in use.
 *
 * Lowering `weekly` to 0.55 and raising `daily` to 1.6 moves the level from the
 * fortnight to the day. Measured over 100 charts x 120 real days: day-to-day change
 * 10.2 -> 18.3, lag-1 autocorrelation 0.80 -> 0.39, flat low weeks 28 -> 1, and the
 * distribution across 0-100 unchanged after recalibration.
 *
 * This is the only lever that survives recalibration, because it changes the RATIO
 * of fast variation to slow level rather than the overall scale — anything that
 * merely scales an area's raw values gets absorbed when sigma is refitted.
 *
 * The cost, accepted knowingly: neither a hard Saturn period nor a two-week Venus
 * transit shows up as a sustained stretch of low or high scores.
 */
export const LAYER_GAIN: Record<Layer, number> = {
    daily: 1.6,
    weekly: 0.55,
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
