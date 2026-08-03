import { ZodiacSign } from "../../utils/natalUtils";

export type AspectType = "conjunction" | "sextile" | "square" | "trine" | "opposition";

export type TransitAspectType = "conjunction" | "harmonious" | "challenging";

export type Planet = "sun" | "moon" | "mercury" | "venus" | "mars" | "jupiter" | "saturn";

export interface Aspect {
    planetA: Planet;
    planetB: Planet;

    aspect: AspectType;

    orb: number;

    orbStrength: number;
}

export interface PlanetPosition {
    sign: ZodiacSign;
    longitude: number;
}

export type Rule = RelationshipRule | TransitRule;

export interface ScoredRelationshipAspect {
    aspect: Aspect;
    rule: RelationshipRule;
    score: number;
    positive: number;
    negative: number;
    aspectStrength: number;
    planetWeight: number;
    orbStrength: number;
}

export interface ScoredTransitAspect {
    aspect: Aspect;
    rule: TransitRule;
    score: number;
    positive: number;
    negative: number;
    aspectStrength: number;
    planetWeight: number;
    orbStrength: number;
}

export type ScoredAspect = ScoredRelationshipAspect | ScoredTransitAspect;

export interface TransitBreakdown {
    emotional: number;
    love: number;
    communication: number;
    motivation: number;
}

export interface DailyCompatibilityResult {
    modifier: number;
    userModifier: number;
    partnerModifier: number;
    userPositive: number;
    userNegative: number;
    partnerPositive: number;
    partnerNegative: number;
    positiveOverall: number;
    negativeOverall: number;
    positiveAspects: ScoredAspect[];
    negativeAspects: ScoredAspect[];
    userBreakdown: TransitBreakdown;
    partnerBreakdown: TransitBreakdown;
    overallBreakdown: TransitBreakdown;
    userAspects: ScoredTransitAspect[];
    partnerAspects: ScoredTransitAspect[];
}

export type RelationshipCategory = "emotional" | "communication" | "chemistry" | "trust" | "longTerm";

export type TransitCategory = "emotional" | "love" | "communication" | "motivation";

export type Category = RelationshipCategory | TransitCategory;

export interface RelationshipRule {
    planetA: Planet;
    planetB: Planet;
    aspect: AspectType;
    /**
     * Astrological influence.
     * Negative = challenging
     * Positive = harmonious
     */
    impact: number;
    /**
     * Relative importance for relationship compatibility.
     * Range: 1.0 - 2.0
     */
    importance: number;
    category: RelationshipCategory;
    title: string;
    description: string;
}

export interface TransitRule {
    planetA: Planet;
    planetB: Planet;
    aspect: TransitAspectType;
    impact: number;
    importance: number;
    category: TransitCategory;
    title: string;
    description: string;
}

export type NatalChart = Record<Planet, PlanetPosition>;

export type TransitChart = Record<Planet, PlanetPosition>;

export interface ScoreTotals {
    positive: number;
    negative: number;
    overall: number;
}

export interface RelationshipBreakdown {
    emotional: number;
    communication: number;
    chemistry: number;
    trust: number;
    longTerm: number;
}

export interface AspectDefinition {
    type: AspectType;
    angle: number;
    maxOrb: number;
}

export interface NormalizerConfig {
    median: number;
    sigma: number;
}

export interface CompatibilityResult {
    positive: number;
    negative: number;
    overall: number;
    breakdown: RelationshipBreakdown;
    breakdownRaw: RelationshipBreakdown;
    positiveAspects: ScoredAspect[];
    negativeAspects: ScoredAspect[];
    aspects: ScoredRelationshipAspect[];
}
