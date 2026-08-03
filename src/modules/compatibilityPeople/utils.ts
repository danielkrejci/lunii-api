import { RELATIONSHIP_RULES, TRANSIT_RULES } from "./rules";
import {
    AspectType,
    ScoreTotals,
    Planet,
    TransitRule,
    NatalChart,
    Aspect,
    AspectDefinition,
    TransitChart,
    RelationshipBreakdown,
    TransitBreakdown,
    ScoredRelationshipAspect,
    ScoredTransitAspect,
    ScoredAspect,
} from "./types";

export const PLANET_WEIGHTS: Record<Planet, number> = {
    moon: 1.0,

    sun: 0.9,

    mercury: 0.85,
    venus: 0.85,

    mars: 0.8,

    jupiter: 0.35,
    saturn: 0.2,
};

export const MAX_ORBS: Record<AspectType, number> = {
    conjunction: 8,
    sextile: 5,
    square: 7,
    trine: 7,
    opposition: 8,
};

export const ASPECTS: AspectDefinition[] = [
    {
        type: "conjunction",
        angle: 0,
        maxOrb: MAX_ORBS.conjunction,
    },
    {
        type: "sextile",
        angle: 60,
        maxOrb: MAX_ORBS.sextile,
    },
    {
        type: "square",
        angle: 90,
        maxOrb: MAX_ORBS.square,
    },
    {
        type: "trine",
        angle: 120,
        maxOrb: MAX_ORBS.trine,
    },
    {
        type: "opposition",
        angle: 180,
        maxOrb: MAX_ORBS.opposition,
    },
];

export const ASPECT_GROUP: Record<AspectType, TransitRule["aspect"]> = {
    conjunction: "conjunction",

    trine: "harmonious",
    sextile: "harmonious",

    square: "challenging",
    opposition: "challenging",
};

export const ASPECT_STRENGTH: Record<AspectType, number> = {
    conjunction: 1.0,

    trine: 0.95,
    sextile: 0.8,

    square: 1.0,
    opposition: 0.9,
};

export const NEGATIVE_WEIGHT = 0.5;

export const MAX_DAILY_MODIFIER = 10;

export const DAILY_TRANSIT_PLANETS: Planet[] = ["sun", "moon", "mercury", "venus", "mars", "jupiter", "saturn"];

export function angularDistance(longitudeA: number, longitudeB: number): number {
    let distance = Math.abs(longitudeA - longitudeB);

    if (distance > 180) {
        distance = 360 - distance;
    }

    return distance;
}

export function calculateStrength(orb: number, maxOrb: number): number {
    return Math.max(0, 1 - orb / maxOrb);
}

export function getRelationshipRule(planets: [Planet, Planet], aspect: AspectType) {
    return RELATIONSHIP_RULES.find((rule) => {
        const sameOrder = rule.planetA === planets[0] && rule.planetB === planets[1];
        const reverseOrder = rule.planetA === planets[1] && rule.planetB === planets[0];
        return (sameOrder || reverseOrder) && rule.aspect === aspect;
    });
}

export function getTransitRule(planetA: Planet, planetB: Planet, aspect: AspectType) {
    const groupedAspect = ASPECT_GROUP[aspect];

    return TRANSIT_RULES.find(
        (rule) => rule.planetA === planetA && rule.planetB === planetB && rule.aspect === groupedAspect
    );
}

export function aggregateScore(aspects: ScoredAspect[]): ScoreTotals {
    const positive = aspects.reduce((sum, aspect) => sum + aspect.positive, 0);
    const negative = aspects.reduce((sum, aspect) => sum + aspect.negative, 0);
    const overall = positive - negative * NEGATIVE_WEIGHT;

    return {
        positive,
        negative,
        overall,
    };
}

const PLANETS: Planet[] = ["sun", "moon", "mercury", "venus", "mars", "jupiter", "saturn"];

export function calculateSynastryAspects(chartA: NatalChart, chartB: NatalChart): Aspect[] {
    const aspects: Aspect[] = [];

    for (const planetA of PLANETS) {
        for (const planetB of PLANETS) {
            const distance = angularDistance(chartA[planetA].longitude, chartB[planetB].longitude);

            for (const definition of ASPECTS) {
                const orb = Math.abs(distance - definition.angle);

                if (orb > definition.maxOrb) {
                    continue;
                }

                aspects.push({
                    planetA,
                    planetB,
                    aspect: definition.type,
                    orb,
                    orbStrength: calculateStrength(orb, definition.maxOrb),
                });

                break;
            }
        }
    }

    return aspects.sort((a, b) => a.orb - b.orb);
}

export function calculateTransitAspects(transit: TransitChart, chart: NatalChart): Aspect[] {
    const aspects: Aspect[] = [];

    for (const planetA of DAILY_TRANSIT_PLANETS) {
        for (const planetB of DAILY_TRANSIT_PLANETS) {
            const distance = angularDistance(transit[planetA].longitude, chart[planetB].longitude);

            if (Number.isNaN(distance)) {
                console.error("NaN distance", {
                    planetA,
                    planetB,
                    transitLongitude: transit[planetA].longitude,
                    natalLongitude: chart[planetB].longitude,
                });
            }

            for (const definition of ASPECTS) {
                const orb = Math.abs(distance - definition.angle);

                if (orb > definition.maxOrb) {
                    continue;
                }

                aspects.push({
                    planetA,
                    planetB,
                    aspect: definition.type,
                    orb,
                    orbStrength: calculateStrength(orb, definition.maxOrb),
                });

                break;
            }
        }
    }

    return aspects.sort((a, b) => a.orb - b.orb);
}

export function selectTopAspects<T extends ScoredAspect>(aspects: T[], limit = 7, minScore = 3): T[] {
    return [...aspects]
        .filter((a) => Math.abs(a.score) >= minScore)
        .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
        .slice(0, limit);
}

export function findPositiveAspects(aspects: ScoredAspect[]): ScoredAspect[] {
    if (aspects.length === 0) {
        return [];
    }

    return aspects.filter((a) => a.score > 0).sort((a, b) => b.score - a.score);
}

export function findNegativeAspects(aspects: ScoredAspect[]): ScoredAspect[] {
    if (aspects.length === 0) {
        return [];
    }

    return aspects.filter((a) => a.score < 0).sort((a, b) => a.score - b.score);
}

export function buildRelationshipBreakdown(aspects: ScoredRelationshipAspect[]): RelationshipBreakdown {
    const breakdown: RelationshipBreakdown = {
        emotional: 0,
        communication: 0,
        chemistry: 0,
        trust: 0,
        longTerm: 0,
    };

    for (const aspect of aspects) {
        breakdown[aspect.rule.category] += aspect.score;
    }

    return breakdown;
}

export function buildTransitBreakdown(aspects: ScoredTransitAspect[]): TransitBreakdown {
    const breakdown: TransitBreakdown = {
        emotional: 0,
        love: 0,
        communication: 0,
        motivation: 0,
    };

    for (const aspect of aspects) {
        const rule = aspect.rule;

        breakdown[rule.category] += aspect.score;
    }

    return breakdown;
}
