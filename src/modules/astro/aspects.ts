import {
    AspectGroup,
    AspectHit,
    AspectType,
    ASPECT_TYPES,
    NatalChart,
    NatalPoint,
    NATAL_POINTS,
    PERSONAL_POINTS,
    PLANETS,
    TransitChart,
} from "./types";

/* ============================================================
   ASPECT DEFINITIONS
============================================================ */

export const ASPECT_ANGLES: Record<AspectType, number> = {
    conjunction: 0,
    sextile: 60,
    square: 90,
    trine: 120,
    opposition: 180,
};

export const MAX_ORBS: Record<AspectType, number> = {
    conjunction: 8,
    opposition: 8,
    square: 7,
    trine: 7,
    sextile: 4,
};

export const ASPECT_GROUP: Record<AspectType, AspectGroup> = {
    conjunction: "conjunction",
    trine: "harmonious",
    sextile: "harmonious",
    square: "challenging",
    opposition: "challenging",
};

/**
 * Extra orb granted to the natal Moon when the birth time is unknown. The Moon
 * moves ~13.2°/day, so an assumed noon puts it up to ~6.6° off its real place.
 */
export const UNKNOWN_TIME_MOON_ORB_BONUS = 2;

/* ============================================================
   GEOMETRY
============================================================ */

export function angularDistance(longitudeA: number, longitudeB: number): number {
    const difference = Math.abs(longitudeA - longitudeB) % 360;

    return Math.min(difference, 360 - difference);
}

/** 1 at exact, 0 at the edge of the orb. Continuous, so daily scores glide instead of stepping. */
export function orbStrength(orb: number, maxOrb: number): number {
    return Math.max(0, 1 - orb / maxOrb);
}

/**
 * Tightest aspect between two longitudes, or null. Aspect angles are far enough
 * apart that at most one can match, but we pick the minimum orb explicitly so
 * the result never depends on iteration order.
 */
export function findAspect(
    longitudeA: number,
    longitudeB: number,
    orbBonus = 0
): { aspect: AspectType; orb: number; maxOrb: number } | null {
    const distance = angularDistance(longitudeA, longitudeB);

    if (Number.isNaN(distance)) {
        return null;
    }

    let best: { aspect: AspectType; orb: number; maxOrb: number } | null = null;

    for (const aspect of ASPECT_TYPES) {
        const maxOrb = MAX_ORBS[aspect] + orbBonus;
        const orb = Math.abs(distance - ASPECT_ANGLES[aspect]);

        if (orb > maxOrb) {
            continue;
        }

        if (!best || orb < best.orb) {
            best = { aspect, orb, maxOrb };
        }
    }

    return best;
}

/* ============================================================
   TRANSIT → NATAL
============================================================ */

export interface FindAspectsOptions {
    /**
     * Widen the natal Moon's orb. Set when the birth time is unknown, so a Moon
     * that is up to ~6.6° off still registers its aspects.
     */
    widenNatalMoon?: boolean;
}

/**
 * Every transit-to-natal aspect for one day, at most one per (transit, natal) pair.
 *
 * Iterates the PLANETS / NATAL_POINTS constants, so the output order is fixed
 * regardless of how the chart's keys came back from JSONB. Downstream summation
 * depends on that: float addition is not associative.
 */
export function findTransitToNatalAspects(
    transits: TransitChart,
    natal: NatalChart,
    options: FindAspectsOptions = {}
): AspectHit[] {
    const hits: AspectHit[] = [];

    for (const transit of PLANETS) {
        const transitPosition = transits[transit];

        if (!transitPosition) {
            continue;
        }

        for (const natalPoint of NATAL_POINTS) {
            const natalPosition = natal[natalPoint];

            // Ascendant is absent when the birth time is unknown.
            if (!natalPosition) {
                continue;
            }

            const orbBonus = options.widenNatalMoon && natalPoint === "moon" ? UNKNOWN_TIME_MOON_ORB_BONUS : 0;

            const found = findAspect(transitPosition.longitude, natalPosition.longitude, orbBonus);

            if (!found) {
                continue;
            }

            hits.push({
                transit,
                natal: natalPoint,
                aspect: found.aspect,
                group: ASPECT_GROUP[found.aspect],
                orb: found.orb,
                strength: orbStrength(found.orb, found.maxOrb),
            });
        }
    }

    return hits;
}

/* ============================================================
   NATAL → NATAL
============================================================ */

/**
 * One standing aspect inside the birth chart itself.
 *
 * Deliberately not an `AspectHit`: that type names a transiting body and a natal one,
 * and here neither side is moving. These do not change over a lifetime, which is the
 * whole point of them — they describe how someone is built rather than what today is
 * doing to them.
 */
export interface NatalAspect {
    a: NatalPoint;
    b: NatalPoint;
    aspect: AspectType;
    group: AspectGroup;
    orb: number;
    /** 1 at exact, 0 at the edge of the orb. */
    strength: number;
}

/**
 * Every aspect the chart makes to itself, tightest first.
 *
 * Each unordered pair is visited once — the inner loop starts past the outer one — so a
 * Sun–Saturn square is reported as one aspect rather than as itself and its mirror.
 * Iterates NATAL_POINTS, so the order is fixed regardless of how the chart's keys came
 * back from JSONB.
 */
export interface FindNatalAspectsOptions extends FindAspectsOptions {
    /**
     * Keep only aspects with at least one personal endpoint. Off by default so the
     * geometry stays complete; on for anything that describes the person rather than
     * the chart.
     */
    personalOnly?: boolean;
}

export function findNatalAspects(natal: NatalChart, options: FindNatalAspectsOptions = {}): NatalAspect[] {
    const aspects: NatalAspect[] = [];

    for (let i = 0; i < NATAL_POINTS.length; i++) {
        const a = NATAL_POINTS[i];
        const positionA = natal[a];

        // Ascendant is absent when the birth time is unknown.
        if (!positionA) {
            continue;
        }

        for (let j = i + 1; j < NATAL_POINTS.length; j++) {
            const b = NATAL_POINTS[j];
            const positionB = natal[b];

            if (!positionB) {
                continue;
            }

            if (options.personalOnly && !PERSONAL_POINTS.includes(a) && !PERSONAL_POINTS.includes(b)) {
                continue;
            }

            // Same bonus as the transit path, and for the same reason: an assumed noon
            // puts the Moon up to ~6.6° from where it really was.
            const orbBonus = options.widenNatalMoon && (a === "moon" || b === "moon") ? UNKNOWN_TIME_MOON_ORB_BONUS : 0;

            const found = findAspect(positionA.longitude, positionB.longitude, orbBonus);

            if (!found) {
                continue;
            }

            aspects.push({
                a,
                b,
                aspect: found.aspect,
                group: ASPECT_GROUP[found.aspect],
                orb: found.orb,
                strength: orbStrength(found.orb, found.maxOrb),
            });
        }
    }

    return aspects.sort((x, y) => y.strength - x.strength || x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
}

/** Canonical key for an unordered pair, so AspectRule lookups are direction-free. */
export function pairKey(a: NatalPoint, b: NatalPoint): string {
    return [a, b].sort().join("-");
}
