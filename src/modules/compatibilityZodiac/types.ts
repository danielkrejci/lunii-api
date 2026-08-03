import { ZodiacSign } from "../../utils/natalUtils";

export type SignDistance = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type TransitRelation = "conjunction" | "sextile" | "square" | "trine" | "opposition";

export type SignRelation = "conjunction" | "semi-sextile" | "sextile" | "square" | "trine" | "quincunx" | "opposition";

export interface TransitInfluence {
    /** Closest major transit aspect. */
    relation: TransitRelation;

    /** Angular distance from the exact aspect, in degrees. */
    orb: number;

    /** Normalized influence strength (0–1). */
    strength: number;
}

/**
 * Planets used for daily compatibility calculations.
 */
export type CompatibilityPlanet = "venus" | "moon" | "mars";

/**
 * Position of a transiting planet.
 *
 * `longitude` is the absolute geocentric ecliptic longitude (0°–360°),
 * where each zodiac sign occupies a 30° segment.
 */
export interface TransitPlanet {
    sign: ZodiacSign;
    longitude: number;
}

/**
 * Transit data required for daily compatibility calculations.
 *
 * Objects may contain additional planets, but only Venus, Moon, and Mars
 * are used.
 */
export interface CompatibilityTransits {
    venus: TransitPlanet;
    moon: TransitPlanet;
    mars: TransitPlanet;
}

export interface PlanetCompatibilityResult {
    planet: CompatibilityPlanet;
    sign: ZodiacSign;
    longitude: number;
    userRelation: TransitRelation | null;
    targetRelation: TransitRelation | null;
    userOrb: number | null;
    targetOrb: number | null;
    userStrength: number;
    targetStrength: number;
    userSupport: number;
    targetSupport: number;
    /**
     * Final compatibility score contributed by this planet.
     *
     * Range: 0–100.
     */
    score: number;
}

/**
 * Base compatibility between two zodiac signs.
 *
 * Includes the compatibility score together with the astrological
 * relationship and the values used to derive it.
 */
export interface BaseCompatibilityResult {
    score: number;
    distance: SignDistance;
    angle: number;
    relation: SignRelation;
}

/**
 * Complete daily compatibility result for a pair of zodiac signs.
 *
 * Includes the normalized overall score, the raw score before normalization,
 * and a detailed breakdown of each scoring component.
 */
export interface DailyCompatibilityResult {
    userSign: ZodiacSign;
    targetSign: ZodiacSign;
    score: number;
    rawScore: number;
    components: {
        base: BaseCompatibilityResult;
        venus: PlanetCompatibilityResult;
        moon: PlanetCompatibilityResult;
        mars: PlanetCompatibilityResult;
    };
}
