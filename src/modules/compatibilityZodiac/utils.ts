import { getAngularDistance, SIGN_CENTER, SIGN_INDEX, ZodiacSign } from "../../utils/natalUtils";
import { SignDistance, SignRelation, TransitInfluence, TransitRelation } from "./types";

/**
 * Base support score assigned to each zodiac sign relationship.
 *
 * These values are static and represent the core compatibility model
 * used throughout the scoring system.
 */
const SUPPORT_BY_RELATION: Record<SignRelation, number> = {
    conjunction: 90,
    "semi-sextile": 60,
    sextile: 88,
    square: 20,
    trine: 100,
    quincunx: 40,
    opposition: 35,
};

/**
 * Maximum orb (in degrees) used when calculating transit strength.
 *
 * A value of 15° provides a gradual decay in influence while keeping
 * aspects outside this range effectively insignificant.
 */
const MAX_ORB_BY_TRANSIT_RELATION: Record<TransitRelation, number> = {
    conjunction: 15,
    sextile: 15,
    square: 15,
    trine: 15,
    opposition: 15,
};

/**
 * Relative contribution of each component to the final compatibility score.
 *
 * The weights must always add up to 1.0 (100%).
 */
export const FINAL_WEIGHTS = {
    // Base compatibility derived from zodiac sign relationships.
    base: 0.25,

    // Influence of Venus, representing harmony and attraction.
    venus: 0.3,

    // Influence of the Moon, representing emotions and daily mood.
    moon: 0.35,

    // Influence of Mars, representing energy and motivation.
    mars: 0.1,
} as const;

/**
 * Maps the angular distance between two zodiac signs to their
 * corresponding astrological relationship.
 *
 * Since each zodiac sign spans 30°, the distance is expressed as the
 * number of signs separating them (0–6).
 */
export const SIGN_RELATION_BY_DISTANCE: Record<SignDistance, SignRelation> = {
    0: "conjunction",
    1: "semi-sextile",
    2: "sextile",
    3: "square",
    4: "trine",
    5: "quincunx",
    6: "opposition",
};

export const BASE_SCORE_BY_RELATION: Record<SignRelation, number> = {
    conjunction: 82,
    "semi-sextile": 52,
    sextile: 88,
    square: 28,
    trine: 95,
    quincunx: 38,
    opposition: 58,
};

/**
 * Calculates how strongly a transiting planet influences a zodiac sign.
 *
 * The function finds the closest major aspect between the planet's current
 * position and the center of the zodiac sign, then converts the aspect orb
 * into a normalized strength value.
 *
 * @param planetDegree Current ecliptic longitude of the transiting planet (0–360°).
 * @param sign Zodiac sign being evaluated.
 * @returns The closest aspect, its orb, and the resulting influence strength.
 */
export function getTransitInfluence(planetDegree: number, sign: ZodiacSign): TransitInfluence {
    // Angular distance between the planet and the center of the zodiac sign.
    const angle = getAngularDistance(planetDegree, SIGN_CENTER[sign]);

    // Major aspects considered when evaluating transit influence.
    const aspects = [
        { relation: "conjunction", angle: 0 },
        { relation: "sextile", angle: 60 },
        { relation: "square", angle: 90 },
        { relation: "trine", angle: 120 },
        { relation: "opposition", angle: 180 },
    ] as const;

    // Start by assuming conjunction is the closest aspect.
    let closest: (typeof aspects)[number] = aspects[0];
    let closestOrb = Math.abs(angle - closest.angle);

    // Find the aspect with the smallest angular difference (orb).
    for (const aspect of aspects.slice(1)) {
        const orb = Math.abs(angle - aspect.angle);

        if (orb < closestOrb) {
            closest = aspect;
            closestOrb = orb;
        }
    }

    // Maximum orb allowed for the detected aspect.
    const maxOrb = MAX_ORB_BY_TRANSIT_RELATION[closest.relation];

    return {
        // Closest major aspect.
        relation: closest.relation,

        // Angular distance from the exact aspect.
        orb: closestOrb,

        // Influence strength decreases exponentially as the orb increases.
        strength: Math.exp(-closestOrb / maxOrb),
    };
}

/**
 * Converts a transit influence into a support score.
 *
 * An exact aspect (strength = 1) receives its full support score, while the
 * score gradually converges toward the neutral value (50) as the influence
 * weakens.
 */
export function getTransitSupport(influence: TransitInfluence): number {
    const neutralSupport = 50;
    const exactSupport = SUPPORT_BY_RELATION[influence.relation];

    return neutralSupport + (exactSupport - neutralSupport) * influence.strength;
}

/**
 * Calculates the shortest distance between two zodiac signs.
 *
 * The zodiac is treated as a circular sequence of 12 signs, so the result
 * is always the minimum distance in the range 0–6.
 *
 * @param firstSign First zodiac sign.
 * @param secondSign Second zodiac sign.
 * @returns Number of signs separating the two signs.
 */
export function getSignDistance(firstSign: ZodiacSign, secondSign: ZodiacSign): SignDistance {
    const firstIndex = SIGN_INDEX[firstSign];
    const secondIndex = SIGN_INDEX[secondSign];

    // Distance when moving directly through the zodiac.
    const directDistance = Math.abs(firstIndex - secondIndex);

    // Shortest distance, accounting for the 12-sign zodiac cycle.
    const shortestDistance = Math.min(directDistance, 12 - directDistance);

    return shortestDistance as SignDistance;
}

/**
 * Determines the astrological relationship between two zodiac signs.
 *
 * The relationship is derived from the shortest distance between the signs
 * in the zodiac cycle.
 *
 * @param firstSign First zodiac sign.
 * @param secondSign Second zodiac sign.
 * @returns Astrological relationship between the two signs.
 */
export function getSignRelation(firstSign: ZodiacSign, secondSign: ZodiacSign): SignRelation {
    const distance = getSignDistance(firstSign, secondSign);

    return SIGN_RELATION_BY_DISTANCE[distance];
}
