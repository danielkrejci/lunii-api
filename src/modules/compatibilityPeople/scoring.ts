import { Aspect, ScoredRelationshipAspect, ScoredTransitAspect } from "./types";
import { getRelationshipRule, PLANET_WEIGHTS, getTransitRule, ASPECT_STRENGTH } from "./utils";

export function scoreAspect(aspect: Aspect): ScoredRelationshipAspect | null {
    const rule = getRelationshipRule([aspect.planetA, aspect.planetB], aspect.aspect);

    if (!rule) {
        return null;
    }

    const aspectStrength = ASPECT_STRENGTH[aspect.aspect];

    const planetWeight = (PLANET_WEIGHTS[aspect.planetA] + PLANET_WEIGHTS[aspect.planetB]) / 2;

    const orbStrength = aspect.orbStrength;

    const score = rule.impact * rule.importance * aspectStrength * planetWeight * orbStrength;

    return {
        aspect,
        rule,
        score,
        positive: Math.max(score, 0),
        negative: Math.max(-score, 0),
        aspectStrength: ASPECT_STRENGTH[aspect.aspect],
        orbStrength: aspect.orbStrength,
        planetWeight,
    };
}

export function scoreTransitAspect(aspect: Aspect): ScoredTransitAspect | null {
    if (["jupiter", "saturn"].includes(aspect.planetA) || ["jupiter", "saturn"].includes(aspect.planetB)) {
        return null;
    }

    const rule = getTransitRule(aspect.planetA, aspect.planetB, aspect.aspect);

    if (!rule) {
        console.warn("Missing transit rule", aspect.planetA, aspect.planetB, aspect.aspect);
        return null;
    }

    const aspectStrength = ASPECT_STRENGTH[aspect.aspect];

    const planetWeight = PLANET_WEIGHTS[aspect.planetA];

    const orbStrength = aspect.orbStrength;

    const score = rule.impact * rule.importance * aspectStrength * planetWeight * orbStrength;

    return {
        aspect,
        rule,
        score,
        positive: Math.max(score, 0),
        negative: Math.max(-score, 0),
        aspectStrength: ASPECT_STRENGTH[aspect.aspect],
        planetWeight: PLANET_WEIGHTS[aspect.planetA],
        orbStrength: aspect.orbStrength,
    };
}
