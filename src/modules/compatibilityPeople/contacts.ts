import { AspectType, DailyCompatibilityResult, Planet, ScoredTransitAspect, TransitCategory } from "./types";

/**
 * Whose natal chart today's transit is landing on.
 *
 * The transits themselves are the same sky for both people, so the only thing that makes
 * an aspect theirs is the chart it touches. A value, not just a type, so the route schema
 * can validate against the same list.
 */
export const CONTACT_SIDES = ["reader", "person"] as const;

export type ContactSide = (typeof CONTACT_SIDES)[number];

/**
 * One aspect of today's sky to one of the two charts, ready to be shown and to be
 * written about.
 *
 * The same shape the Moon screen and the daily horoscope use for their contact panels,
 * so the app renders all three with one component — with `side` on top, because here
 * every aspect belongs to one of two people and the reader has to know which.
 */
export interface CompatibilityContact {
    /**
     * "reader_moon_square_venus". Carries the side because the same transit can hit the
     * same natal planet in both charts on the same day, and two rows with one id would
     * join the written half onto the wrong aspect.
     */
    id: string;
    side: ContactSide;
    /** The transiting planet. Today's sky, shared by both of them. */
    transit: Planet;
    /** The natal planet it lands on, in the chart named by `side`. */
    natal: Planet;
    aspect: AspectType;
    /** Degrees from exact, one decimal. */
    orb: number;
    /** 0–100. How precisely the aspect lands today. */
    exactness: number;
    /** Supportive or difficult, from the signed score. */
    supportive: boolean;
    category: TransitCategory;
    /** English caption from the rule, for the prompt to translate. */
    title: string;
    /** English meaning from the rule, for the prompt to compress into today's terms. */
    description: string;
}

/**
 * How many aspects the screen and the prompt both get.
 *
 * One constant for both on purpose — the text is written from these aspects, so showing
 * a different set underneath it would caption the copy with something it never saw.
 */
export const CONTACT_LIMIT = 6;

function toContact(scored: ScoredTransitAspect, side: ContactSide): CompatibilityContact {
    const { aspect, rule, score } = scored;

    return {
        id: `${side}_${aspect.planetA}_${aspect.aspect}_${aspect.planetB}`,
        side,
        // planetA is always the transiting body and planetB the natal one: the engine
        // walks today's sky against a chart, never a chart against a chart.
        transit: aspect.planetA,
        natal: aspect.planetB,
        aspect: aspect.aspect,
        orb: Math.round(aspect.orb * 10) / 10,
        exactness: Math.round(aspect.orbStrength * 100),
        supportive: score > 0,
        category: rule.category,
        title: rule.title,
        description: rule.description,
    };
}

/**
 * Today's aspects to both charts, most exact first.
 *
 * Computed from the stored `compatibility` blob rather than recomputed from the
 * ephemeris, so what is shown is always the set the day's score was built from.
 *
 * Both sides are ranked together and then cut: some days the sky is doing everything to
 * one of them and nothing to the other, and a fixed three-and-three would drop real
 * aspects to make room for weak ones.
 */
export function dailyContacts(compatibility: DailyCompatibilityResult, limit = CONTACT_LIMIT): CompatibilityContact[] {
    /**
     * `partnerAspects` are the ones cast against the READER's natal chart, and
     * `userAspects` the ones against the other person's — the fields are named for whose
     * side of the pair the transit is being read for, not for whose chart it touches.
     */
    const scored = [
        ...compatibility.partnerAspects.map((aspect) => ({ aspect, side: "reader" as const })),
        ...compatibility.userAspects.map((aspect) => ({ aspect, side: "person" as const })),
    ];

    /**
     * Chosen by score, shown by exactness — the two answer different questions.
     *
     * The score carries the planetary weight, the importance of the rule and the orb
     * strength, so it is the only ranking that agrees with the number above these aspects
     * and the only sane way to decide which ones the reading gets written from. Sorting
     * the whole list by orb instead would hand the text an exact sextile of a slow planet
     * over a Venus contact carrying ten times its weight.
     *
     * Within the ones that made the cut, exactness is what the reader is comparing: the
     * percentage is on screen next to each row, and a list that does not descend by it
     * reads as unsorted.
     */
    return scored
        .sort((a, b) => Math.abs(b.aspect.score) - Math.abs(a.aspect.score))
        .slice(0, limit)
        .map((entry) => toContact(entry.aspect, entry.side))
        .sort((a, b) => b.exactness - a.exactness);
}
