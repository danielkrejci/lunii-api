import { ZodiacSign } from "../../utils/natalUtils";

/* ============================================================
   POINTS
============================================================ */

export type Planet =
    | "sun"
    | "moon"
    | "mercury"
    | "venus"
    | "mars"
    | "jupiter"
    | "saturn"
    | "uranus"
    | "neptune"
    | "pluto";

/**
 * Fixed iteration order. Every aggregation over points MUST iterate these
 * constants rather than Object.keys() — charts are read back from JSONB, where
 * key order is not guaranteed, and float addition is not associative.
 */
export const PLANETS: readonly Planet[] = [
    "sun",
    "moon",
    "mercury",
    "venus",
    "mars",
    "jupiter",
    "saturn",
    "uranus",
    "neptune",
    "pluto",
];

/** Points that can be aspected in a natal chart. The Ascendant is never a transiting body. */
export type NatalPoint = Planet | "ascendant";

export const NATAL_POINTS: readonly NatalPoint[] = [...PLANETS, "ascendant"];

/** Slow points are generational — a whole birth cohort shares them. */
export const OUTER_PLANETS: readonly Planet[] = ["uranus", "neptune", "pluto"];

export type Layer = "fast" | "slow";

export const LAYER: Record<Planet, Layer> = {
    moon: "fast",
    mercury: "fast",
    venus: "fast",
    sun: "fast",
    mars: "fast",
    jupiter: "slow",
    saturn: "slow",
    uranus: "slow",
    neptune: "slow",
    pluto: "slow",
};

/* ============================================================
   ASPECTS
============================================================ */

export type AspectType = "conjunction" | "sextile" | "square" | "trine" | "opposition";

export const ASPECT_TYPES: readonly AspectType[] = ["conjunction", "opposition", "square", "trine", "sextile"];

/**
 * Rules are keyed by group rather than by aspect, which keeps the table at
 * 3 entries per pair instead of 5. ASPECT_STRENGTH then separates trine from
 * sextile inside "harmonious".
 */
export type AspectGroup = "conjunction" | "harmonious" | "challenging";

/* ============================================================
   LIFE AREAS
============================================================ */

export type LifeArea = "love" | "career" | "health" | "mood";

export const LIFE_AREAS: readonly LifeArea[] = ["love", "career", "health", "mood"];

/* ============================================================
   CHARTS
============================================================ */

export interface PointPosition {
    sign: ZodiacSign;
    signIndex?: number;
    longitude: number;
    speed?: number;
    retrograde?: boolean;
}

/**
 * The Ascendant is present only when the birth time is known — without it the
 * computed Ascendant is an artefact of an assumed noon, not a real placement.
 */
export type NatalChart = Record<Planet, PointPosition> & { ascendant?: PointPosition };

export type TransitChart = Record<Planet, PointPosition>;

/* ============================================================
   GEOMETRY RESULT
============================================================ */

/**
 * One transit-to-natal aspect. Pure geometry — carries no interpretation.
 * Interpretation happens in dailyScore/resolveAspectRule().
 */
export interface AspectHit {
    transit: Planet;
    natal: NatalPoint;
    aspect: AspectType;
    group: AspectGroup;
    /** Degrees away from the exact angle. */
    orb: number;
    /** 1 at exact, 0 at the edge of the orb. Continuous — no steps. */
    strength: number;
}
