import { AspectGroup, AspectHit, AspectType, LifeArea, NatalPoint, Planet } from "../astro";

/* ============================================================
   RULES
============================================================ */

/**
 * The atomic unit of interpretation: two points in a given aspect group.
 *
 * Keyed on an UNORDERED pair. `transit Venus square natal Moon` and
 * `transit Moon square natal Venus` share the same theme, the same polarity and
 * the same life areas; what differs is how long the aspect holds and how loud it
 * is on a single day, and that is a property of the transiting planet's speed
 * (LAYER_GAIN / SAMPLING_PENALTY), not of the pair.
 *
 * Where direction genuinely changes the meaning rather than just the magnitude,
 * add a DirectionOverride instead of splitting the pair.
 */
export interface AspectRule {
    /** Canonically sorted, so lookups are direction-free. */
    pair: [NatalPoint, NatalPoint];
    group: AspectGroup;

    /** Signed. Comes from the combination, never from a planet being "good" or "bad". −10..+10 */
    baseImpact: number;

    /** How much this pair matters at all. 1.0–2.0 */
    importance: number;

    /** Which areas of life the influence lands in. Must sum to exactly 1. */
    areas: Partial<Record<LifeArea, number>>;

    /**
     * Narrative interest, 1–5. Used ONLY to pick what the prompt talks about.
     * Never enters the score: a conjunction can be intense yet score-neutral.
     */
    priority: number;

    title: string;
    description: string;
}

/** Sparse, direction-specific correction on top of an AspectRule. */
export interface DirectionOverride {
    transit: Planet;
    natal: NatalPoint;
    group: AspectGroup;

    baseImpact?: number;
    importance?: number;
    areas?: Partial<Record<LifeArea, number>>;
    priority?: number;
    title?: string;
    description?: string;
}

/** An AspectRule after any DirectionOverride has been merged in. */
export type ResolvedRule = AspectRule & { overridden: boolean };

/* ============================================================
   IMPACTS
============================================================ */

/**
 * One aspect's contribution to one life area. The engine's intermediate
 * representation: everything downstream (scores, breakdown, prompt, debugging)
 * is derived from a list of these.
 */
export interface Impact {
    area: LifeArea;

    /** Final contribution. Every multiplier is already applied — do not scale again. */
    value: number;

    /** Orb strength, 0–1. Carried for display and sorting only. */
    strength: number;

    /** Degrees away from the exact angle. Display only — `strength` is what scores. */
    orb: number;

    /** rule.baseImpact before any multiplier, for debugging. */
    baseImpact: number;

    transit: Planet;
    natal: NatalPoint;
    aspect: AspectType;
    group: AspectGroup;

    /** 1–5, from the rule. Selection only, never scoring. */
    priority: number;

    /** "Transit Saturn square Natal Moon" */
    reason: string;

    title: string;
}

/* ============================================================
   RESULT
============================================================ */

export interface DailyScores {
    loveScore: number;
    careerScore: number;
    healthScore: number;
    moodScore: number;
    overallScore: number;
}

export type RawScores = Record<LifeArea, number> & { overall: number };

export interface ScoreBreakdown {
    /** Strongest contributions per area, positive and negative. */
    byArea: Record<LifeArea, { positive: Impact[]; negative: Impact[] }>;
    /** Highest-priority impacts overall — what the prompt should talk about. */
    top: Impact[];
}

/**
 * One transit-to-natal contact behind a body's weight, kept whole.
 *
 * The engine's `reason` string alone is enough to write prose from, but not enough
 * to show the reader how close the aspect actually is — an aspect 0.2° from exact
 * and one about to leave orb read identically once flattened to text.
 */
export interface PlanetContact {
    /**
     * "saturn_square_moon". Stable across recomputation, so the translated label
     * written once can be joined back onto tomorrow's recomputed numbers.
     */
    id: string;

    /** "Transit Saturn square Natal Moon" — English, for the prompt to translate. */
    reason: string;

    transit: Planet;
    natal: NatalPoint;
    aspect: AspectType;
    group: AspectGroup;

    /** Degrees away from the exact angle. */
    orb: number;

    /** 0–1, 1 at exact. */
    strength: number;

    /** Signed contribution — negative is difficult, positive supportive. */
    value: number;

    title: string;
}

/**
 * How loud one transiting body is for this chart today.
 *
 * Magnitude, not valence: this answers "how much is Mars in play" rather than
 * "is Mars helping". A body making one exact hard aspect and one exact soft aspect
 * scores high on both counts, because it is loud either way.
 */
export interface PlanetInfluence {
    name: Planet;

    /**
     * 0–100, calibrated per planet against that planet's own norm. Without the
     * per-planet fit the Moon would read ~90 every day and Neptune ~5, which says
     * nothing about today.
     */
    score: number;

    /** Σ |value| over today's impacts from this body. Pre-squash, for debugging. */
    weight: number;

    /** How many aspects this body is making to the natal chart today. */
    aspects: number;

    /** The specific transits behind today's weight, strongest first. */
    contacts: PlanetContact[];
}

export interface DailyScoreResult {
    scores: DailyScores;

    /** Pre-squash sums. Store these: they are what makes a score debuggable later. */
    raw: RawScores;

    /**
     * 0–1. How much signal this chart produced relative to a rich day.
     * Metadata only — never multiplied into the score.
     */
    confidence: number;

    /** Σ (importance × strength) over resolved hits. The numerator behind `confidence`. */
    coveredWeight: number;

    /** Every hit that resolved to a rule. */
    impacts: Impact[];

    breakdown: ScoreBreakdown;

    /** Hits with no matching rule. Should stay empty — the lint script enforces it. */
    unresolved: AspectHit[];
}
