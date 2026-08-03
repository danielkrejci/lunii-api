import { ZodiacSign } from "../../utils/natalUtils";
import { normalizeScore } from "./normalizer";
import {
    BaseCompatibilityResult,
    CompatibilityPlanet,
    CompatibilityTransits,
    DailyCompatibilityResult,
    PlanetCompatibilityResult,
    TransitPlanet,
} from "./types";
import {
    BASE_SCORE_BY_RELATION,
    FINAL_WEIGHTS,
    getSignDistance,
    getSignRelation,
    getTransitInfluence,
    getTransitSupport,
} from "./utils";

/**
 * Calculates the compatibility contribution of a single transiting planet.
 *
 * The score combines:
 * - the average support for both zodiac signs, and
 * - the similarity of their support values.
 *
 * This rewards planets that are both favorable and similarly supportive
 * for both signs.
 */
function calculatePlanetCompatibility(
    planet: CompatibilityPlanet,
    transit: TransitPlanet,
    userSign: ZodiacSign,
    targetSign: ZodiacSign
): PlanetCompatibilityResult {
    const userInfluence = getTransitInfluence(transit.longitude, userSign);

    const targetInfluence = getTransitInfluence(transit.longitude, targetSign);

    const userSupport = getTransitSupport(userInfluence);

    const targetSupport = getTransitSupport(targetInfluence);

    // Average favorability of the transit for both signs.
    const average = (userSupport + targetSupport) / 2;

    // Rewards similar transit influence for both signs.
    const similarity = 100 - Math.abs(userSupport - targetSupport);

    // Weighted combination of favorability and similarity.
    const score = average * 0.7 + similarity * 0.3;

    return {
        planet,
        sign: transit.sign,
        longitude: transit.longitude,
        userRelation: userInfluence.relation,
        targetRelation: targetInfluence.relation,
        userOrb: userInfluence.orb,
        targetOrb: targetInfluence.orb,
        userStrength: userInfluence.strength,
        targetStrength: targetInfluence.strength,
        userSupport,
        targetSupport,
        score,
    };
}

/**
 * Calculates the base compatibility between two zodiac signs.
 *
 * Besides the compatibility score, the function also returns the underlying
 * astrological relationship, angular distance, and angle used to derive it.
 *
 * @param userSign User's zodiac sign.
 * @param targetSign Target zodiac sign.
 * @returns Base compatibility score together with its supporting details.
 */
function calculateBaseCompatibilityDetails(userSign: ZodiacSign, targetSign: ZodiacSign): BaseCompatibilityResult {
    // Number of signs separating the two zodiac signs.
    const distance = getSignDistance(userSign, targetSign);

    // Astrological relationship determined by the sign distance.
    const relation = getSignRelation(userSign, targetSign);

    return {
        // Base compatibility score for the detected relationship.
        score: BASE_SCORE_BY_RELATION[relation],

        // Distance between the two signs (0–6).
        distance,

        // Angular separation in degrees.
        angle: distance * 30,

        // Astrological relationship (e.g. trine, square, opposition).
        relation,
    };
}

/**
 * Calculates today's compatibility between
 * two zodiac signs.
 *
 * The transit data must come from the database
 * record for the requested YYYY-MM-DD date.
 */
export function calculateDailyCompatibility(
    userSign: ZodiacSign,
    targetSign: ZodiacSign,
    transits: CompatibilityTransits
): DailyCompatibilityResult {
    const base = calculateBaseCompatibilityDetails(userSign, targetSign);
    const venus = calculatePlanetCompatibility("venus", transits.venus, userSign, targetSign);
    const moon = calculatePlanetCompatibility("moon", transits.moon, userSign, targetSign);
    const mars = calculatePlanetCompatibility("mars", transits.mars, userSign, targetSign);

    const rawScore =
        base.score * FINAL_WEIGHTS.base +
        venus.score * FINAL_WEIGHTS.venus +
        moon.score * FINAL_WEIGHTS.moon +
        mars.score * FINAL_WEIGHTS.mars;

    const score = normalizeScore(rawScore);

    return {
        userSign,
        targetSign,
        score,
        rawScore,
        components: {
            base,
            venus,
            moon,
            mars,
        },
    };
}
