import {
    ASPECT_GROUP,
    AspectHit,
    AspectType,
    findTransitToNatalAspects,
    LAYER,
    LIFE_AREAS,
    LifeArea,
    MAX_ORBS,
    NatalChart,
    NatalPoint,
    pairKey,
    Planet,
    PLANETS,
    TransitChart,
} from "../astro";
import {
    CALIBRATION,
    EXPECTED_WEIGHT,
    NO_BIRTH_TIME_CONFIDENCE_PENALTY,
    NormalizerConfig,
    PLANET_CALIBRATION,
} from "./calibration";
import { AREA_WEIGHTS, ASPECT_STRENGTH, isExcludedPair, LAYER_GAIN, SAMPLING_PENALTY } from "./factors";
import { DIRECTION_OVERRIDES } from "./overrides";
import { ASPECT_RULES } from "./rules";
import {
    AspectRule,
    ContactSummary,
    DailyScoreResult,
    DailyScores,
    Impact,
    PlanetContact,
    PlanetInfluence,
    RawScores,
    ResolvedRule,
    ScoreBreakdown,
} from "./types";

export * from "./types";
export { CALIBRATION, EXPECTED_WEIGHT } from "./calibration";
export { ASPECT_RULES } from "./rules";
export { DIRECTION_OVERRIDES } from "./overrides";

/* ============================================================
   INDEXES
============================================================ */

const RULE_INDEX = new Map<string, AspectRule>(
    ASPECT_RULES.map((rule) => [`${pairKey(rule.pair[0], rule.pair[1])}|${rule.group}`, rule])
);

const OVERRIDE_INDEX = new Map(
    DIRECTION_OVERRIDES.map((override) => [`${override.transit}>${override.natal}|${override.group}`, override])
);

/* ============================================================
   RULE RESOLUTION
============================================================ */

/** Direction-specific override first, then the unordered pair. Null means no rule covers this hit. */
export function resolveAspectRule(hit: AspectHit): ResolvedRule | null {
    if (isExcludedPair(hit.transit, hit.natal)) {
        return null;
    }

    const rule = RULE_INDEX.get(`${pairKey(hit.transit, hit.natal)}|${hit.group}`);

    if (!rule) {
        return null;
    }

    const override = OVERRIDE_INDEX.get(`${hit.transit}>${hit.natal}|${hit.group}`);

    if (!override) {
        return { ...rule, overridden: false };
    }

    return {
        ...rule,
        baseImpact: override.baseImpact ?? rule.baseImpact,
        importance: override.importance ?? rule.importance,
        areas: override.areas ?? rule.areas,
        priority: override.priority ?? rule.priority,
        title: override.title ?? rule.title,
        description: override.description ?? rule.description,
        overridden: true,
    };
}

/* ============================================================
   IMPACTS
============================================================ */

function displayName(point: NatalPoint): string {
    return point.charAt(0).toUpperCase() + point.slice(1);
}

/**
 * The only place in the engine where numbers are multiplied.
 *
 * One rule yields one Impact per life area it touches, so "the five strongest
 * influences on love today" is a filter rather than a special case.
 */
export function buildImpacts(hit: AspectHit, rule: ResolvedRule): Impact[] {
    const magnitude =
        rule.baseImpact *
        rule.importance *
        ASPECT_STRENGTH[hit.aspect] *
        hit.strength *
        LAYER_GAIN[LAYER[hit.transit]] *
        (SAMPLING_PENALTY[hit.transit] ?? 1);

    const reason = `Transit ${displayName(hit.transit)} ${hit.aspect} Natal ${displayName(hit.natal)}`;

    const impacts: Impact[] = [];

    for (const area of LIFE_AREAS) {
        const share = rule.areas[area];

        if (!share) {
            continue;
        }

        impacts.push({
            area,
            value: magnitude * share,
            strength: hit.strength,
            orb: hit.orb,
            baseImpact: rule.baseImpact,
            transit: hit.transit,
            natal: hit.natal,
            aspect: hit.aspect,
            group: hit.group,
            priority: rule.priority,
            reason,
            title: rule.title,
            description: rule.description,
        });
    }

    return impacts;
}

/* ============================================================
   ISOLATED EVALUATION
============================================================ */

export interface AspectEvaluation {
    rule: ResolvedRule;
    impacts: Impact[];
    /** Signed contribution per area. Zero for areas the rule does not touch. */
    areas: Record<LifeArea, number>;
    /** Sum across areas — equals the rule's magnitude, since area shares total 1. */
    total: number;
    /** Area receiving the largest |contribution|. */
    dominant: LifeArea;
}

/**
 * What one aspect does, on its own, with no chart and no ephemeris.
 *
 * The unit the domain tests assert against: "Saturn square natal Moon must lower
 * mood" is a statement about a rule, not about a particular day.
 */
export function evaluateAspect(
    transit: Planet,
    aspect: AspectType,
    natal: NatalPoint,
    strength = 1
): AspectEvaluation | null {
    const hit: AspectHit = {
        transit,
        natal,
        aspect,
        group: ASPECT_GROUP[aspect],
        orb: (1 - strength) * MAX_ORBS[aspect],
        strength,
    };

    const rule = resolveAspectRule(hit);

    if (!rule) {
        return null;
    }

    const impacts = buildImpacts(hit, rule);

    const areas: Record<LifeArea, number> = { love: 0, career: 0, health: 0, mood: 0 };

    for (const impact of impacts) {
        areas[impact.area] += impact.value;
    }

    const dominant = LIFE_AREAS.reduce(
        (winner, area) => (Math.abs(areas[area]) > Math.abs(areas[winner]) ? area : winner),
        LIFE_AREAS[0]
    );

    return {
        rule,
        impacts,
        areas,
        total: LIFE_AREAS.reduce((sum, area) => sum + areas[area], 0),
        dominant,
    };
}

/* ============================================================
   AGGREGATION
============================================================ */

/**
 * Raw sum to 0–100. A fixed logistic, deliberately not a max-normalisation:
 * areas stay independent, so a strong love transit cannot drag career down, and
 * no area is pinned to 100 every day.
 */
export function squash(raw: number, config: NormalizerConfig): number {
    const normalized = 100 / (1 + Math.exp(-(raw - config.median) / config.sigma));

    return Math.round(Math.max(0, Math.min(100, normalized)));
}

function sumByArea(impacts: Impact[]): Record<LifeArea, number> {
    const totals: Record<LifeArea, number> = { love: 0, career: 0, health: 0, mood: 0 };

    // Impacts arrive in a fixed order (PLANETS × NATAL_POINTS × LIFE_AREAS), so this
    // sum is bit-for-bit reproducible. Float addition is not associative.
    for (const impact of impacts) {
        totals[impact.area] += impact.value;
    }

    return totals;
}

function buildBreakdown(impacts: Impact[], limit = 8): ScoreBreakdown {
    const byArea = {} as ScoreBreakdown["byArea"];

    for (const area of LIFE_AREAS) {
        const inArea = impacts.filter((impact) => impact.area === area);

        byArea[area] = {
            positive: inArea
                .filter((impact) => impact.value > 0)
                .sort(byStrongest)
                .slice(0, 3),
            negative: inArea
                .filter((impact) => impact.value < 0)
                .sort(byStrongest)
                .slice(0, 3),
        };
    }

    // One rule emits an Impact per area, so an unfiltered top list would repeat the
    // same aspect four times and offer the prompt three distinct influences instead
    // of eight. Keep each aspect once, represented by the area it hits hardest.
    const strongestPerAspect = new Map<string, Impact>();

    for (const impact of impacts) {
        const key = `${impact.transit}|${impact.natal}|${impact.aspect}`;
        const current = strongestPerAspect.get(key);

        if (!current || Math.abs(impact.value) > Math.abs(current.value)) {
            strongestPerAspect.set(key, impact);
        }
    }

    return {
        byArea,
        // Narrative interest first: priority is what the prompt should follow, not magnitude.
        top: [...strongestPerAspect.values()]
            .sort(
                (a, b) =>
                    b.priority - a.priority ||
                    Math.abs(b.value) - Math.abs(a.value) ||
                    a.reason.localeCompare(b.reason) ||
                    a.area.localeCompare(b.area)
            )
            .slice(0, limit),
    };
}

function byStrongest(a: Impact, b: Impact): number {
    return Math.abs(b.value) - Math.abs(a.value) || b.priority - a.priority || a.reason.localeCompare(b.reason);
}

/* ============================================================
   PLANET INFLUENCE
============================================================ */

/**
 * Raw weight per transiting body: how much of today's total movement it accounts
 * for. Magnitude only — a body pulling hard in both directions is loud, not neutral.
 */
export function summarizePlanetWeight(impacts: Impact[]): Record<Planet, { weight: number; hits: Set<string> }> {
    const totals = Object.fromEntries(
        PLANETS.map((planet) => [planet, { weight: 0, hits: new Set<string>() }])
    ) as Record<Planet, { weight: number; hits: Set<string> }>;

    for (const impact of impacts) {
        totals[impact.transit].weight += Math.abs(impact.value);
        totals[impact.transit].hits.add(impact.reason);
    }

    return totals;
}

/**
 * Per-body 0–100 scores for one day, strongest first.
 *
 * Each body is squashed against its own calibration, so the number means "loud for
 * this planet" rather than "loud compared to the Moon". Bodies making no aspect
 * today are included with a score of 0 — absence is information.
 */
export function summarizePlanetInfluence(impacts: Impact[], contactLimit = 3): PlanetInfluence[] {
    const totals = summarizePlanetWeight(impacts);

    // Strongest single impact per body, so the contacts name the aspects that carry it.
    const strongest = new Map<Planet, Impact[]>();

    for (const impact of impacts) {
        strongest.set(impact.transit, [...(strongest.get(impact.transit) ?? []), impact]);
    }

    return PLANETS.map((planet) => {
        const { weight, hits } = totals[planet];

        const contacts = [...(strongest.get(planet) ?? [])]
            .sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || a.reason.localeCompare(b.reason))
            // One aspect emits an Impact per life area it touches; the first one seen is
            // the strongest, so keeping it collapses the duplicates without re-sorting.
            .filter((impact, index, all) => all.findIndex((other) => other.reason === impact.reason) === index)
            .slice(0, contactLimit)
            .map((impact) => ({
                id: `${impact.transit}_${impact.aspect}_${impact.natal}`,
                reason: impact.reason,
                transit: impact.transit,
                natal: impact.natal,
                aspect: impact.aspect,
                group: impact.group,
                orb: impact.orb,
                strength: impact.strength,
                value: impact.value,
                title: impact.title,
                description: impact.description,
            }));

        return {
            name: planet,
            score: hits.size === 0 ? 0 : squash(weight, PLANET_CALIBRATION[planet]),
            weight,
            aspects: hits.size,
            contacts,
        };
    }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

/** One contact, flattened for the wire. The single definition of that shape. */
export function toContactSummary(contact: PlanetContact): ContactSummary {
    return {
        id: contact.id,
        transit: contact.transit,
        natal: contact.natal,
        aspect: contact.aspect,
        orb: Math.round(contact.orb * 10) / 10,
        exactness: Math.round(contact.strength * 100),
        supportive: contact.value >= 0,
    };
}

/* ============================================================
   ENTRY POINT
============================================================ */

export interface DailyScoreInput {
    natal: NatalChart;
    /** Transit positions for the instant being scored. The engine never derives them itself. */
    transits: TransitChart;
    /** False widens the natal Moon's orb and penalises confidence. */
    hasBirthTime: boolean;
}

/**
 * Pure function of (natal chart, transit chart). Knows nothing about dates, time
 * zones or the database — sampling several instants per day for peak hours means
 * calling it several times, with no change to this signature.
 */
export function calculateDailyScore(input: DailyScoreInput): DailyScoreResult {
    const hits = findTransitToNatalAspects(input.transits, input.natal, {
        widenNatalMoon: !input.hasBirthTime,
    });

    const impacts: Impact[] = [];
    const unresolved: AspectHit[] = [];

    let coveredWeight = 0;

    for (const hit of hits) {
        const rule = resolveAspectRule(hit);

        if (!rule) {
            if (!isExcludedPair(hit.transit, hit.natal)) {
                unresolved.push(hit);
            }

            continue;
        }

        coveredWeight += rule.importance * hit.strength;

        impacts.push(...buildImpacts(hit, rule));
    }

    const areaTotals = sumByArea(impacts);

    const overallRaw = LIFE_AREAS.reduce((sum, area) => sum + AREA_WEIGHTS[area] * areaTotals[area], 0);

    const raw: RawScores = { ...areaTotals, overall: overallRaw };

    const scores: DailyScores = {
        loveScore: squash(raw.love, CALIBRATION.love),
        careerScore: squash(raw.career, CALIBRATION.career),
        healthScore: squash(raw.health, CALIBRATION.health),
        moodScore: squash(raw.mood, CALIBRATION.mood),
        overallScore: squash(raw.overall, CALIBRATION.overall),
    };

    const confidence =
        Math.round(
            Math.min(1, Math.max(0, coveredWeight / EXPECTED_WEIGHT)) *
                (input.hasBirthTime ? 1 : NO_BIRTH_TIME_CONFIDENCE_PENALTY) *
                100
        ) / 100;

    return {
        scores,
        raw,
        confidence,
        coveredWeight,
        impacts,
        breakdown: buildBreakdown(impacts),
        unresolved,
    };
}
