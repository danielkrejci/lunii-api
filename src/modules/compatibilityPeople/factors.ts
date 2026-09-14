import { Layer, LAYER } from "../astro";
import { AspectType, Planet } from "./types";

/* ============================================================
   ASPECT AND PLANET WEIGHTS
============================================================ */

/**
 * How much each body counts in a synastry contact. Personal bodies carry the
 * relationship; Jupiter and Saturn describe its frame rather than its texture.
 */
export const PLANET_WEIGHTS: Record<Planet, number> = {
    moon: 1.0,

    sun: 0.9,

    mercury: 0.85,
    venus: 0.85,

    mars: 0.8,

    jupiter: 0.35,
    saturn: 0.2,
};

/**
 * Separates trine from sextile inside the "harmonious" group, and square from
 * opposition inside "challenging", so transit rules stay keyed on 3 groups
 * instead of 5 aspects.
 */
export const ASPECT_STRENGTH: Record<AspectType, number> = {
    conjunction: 1.0,

    trine: 0.95,
    sextile: 0.8,

    square: 1.0,
    opposition: 0.9,
};

/* ============================================================
   NEGATIVE WEIGHT
============================================================ */

/**
 * How hard a challenging contact counts against the pair's standing compatibility.
 *
 * Deliberately below 1: friction in a synastry chart is not the same as a bad
 * relationship, and a Mars-Venus square is half the reason some couples work. This
 * describes who they are together and is not what the daily reading moves.
 */
export const RELATIONSHIP_NEGATIVE_WEIGHT = 0.5;

/**
 * How hard a challenging transit counts against the day.
 *
 * Symmetric, unlike the relationship weight above: a day the sky is working against
 * should be able to read as one, and there is no version of the "friction is half the
 * appeal" argument that applies to a single Tuesday.
 *
 * Honest about what this does and does not buy. Under the old flat global normaliser
 * it mattered a lot — halving the downside pushed the average modifier to +16.5 raw,
 * which is why a pair with a base score of 37 saw 46 every day. Under per-pair
 * recentring a constant bias is absorbed by the pair's own median, and measured over
 * 200 pairs x 365 days, moving this from 0.5 to 1.0 changed the resulting spread,
 * day-to-day movement and autocorrelation by nothing at all. It is kept at 1.0 because
 * it is the truer model, not because it is what fixed the flatness.
 */
export const TRANSIT_NEGATIVE_WEIGHT = 1.0;

/* ============================================================
   LAYERS
============================================================ */

/**
 * The single owner of "how much of the day's movement comes from the current few
 * weeks versus from today". Same lever, same reasoning and the same numbers as
 * `dailyScore`'s `LAYER_GAIN` — see the long note there.
 *
 * The compatibility engine had the problem in a sharper form than the daily score
 * did, because it scores today's sky against TWO charts and then sums the top seven
 * contacts on each side. Sun, Mercury, Venus and Mars hold an aspect for 10-20 days,
 * so most of those fourteen slots were filled by the same contacts as yesterday —
 * measured on a real pair, 70.9 % of the aspects scored on any day were also scored
 * the day before. The Moon, the only body that can move the number overnight,
 * contributed about a fifth of it and was averaged away by the rest.
 *
 * A gentler split than the daily score's 1.6/0.55, and the difference is measured, not
 * a matter of taste. This engine has a second source of fast movement that the daily
 * score does not — `RANK_DECAY` below, which lets the leader of the list set the tone,
 * and the leader changes when the Moon does. Swept over 200 pairs x 365 days with sigma
 * refitted for every combination:
 *
 *   gain 1.6/0.55, decay 0.75  ->  |delta| median 17, lag-1 autocorrelation 0.11
 *   gain 1.3/0.70, decay 0.85  ->  |delta| median 15, lag-1 0.32
 *   gain 1.2/0.75, decay 0.85  ->  |delta| median 14, lag-1 0.40
 *   gain 1.1/0.85, decay 0.90  ->  |delta| median 12, lag-1 0.55
 *   gain 1.0/1.00, decay 1.00  ->  |delta| median  9, lag-1 0.71   (the old engine)
 *
 * 1.6/0.55 with the decay on top overshot into near-noise: a score with a lag-1 of 0.11
 * has no yesterday, and two good days in a row stop meaning anything. 1.2/0.75 lands on
 * the profile the daily score settled at (|delta| median 12-18, lag-1 0.39), which is a
 * day that can turn overnight while a good stretch still reads as a stretch.
 *
 * Only the RATIO survives recalibration — scaling every layer together is absorbed when
 * sigma is refitted, which is why the spread column was identical across the sweep.
 *
 * Jupiter and Saturn never reach here — `scoreTransitAspect` drops them — so `slow`
 * is carried only so the table stays total over `Layer`.
 */
export const LAYER_GAIN: Record<Layer, number> = {
    daily: 1.2,
    weekly: 0.75,
    slow: 0.35,
};

/** Which layer a transiting body belongs to. The module's Planet is a subset of astro's. */
export const TRANSIT_LAYER: Record<Planet, Layer> = LAYER;

/* ============================================================
   ASPECT SELECTION
============================================================ */

/**
 * How many contacts per side reach the day's total, and how weak one may be to
 * count at all.
 *
 * Seven is generous on purpose: cutting it does not add movement, it only lowers the
 * total. Measured on a real pair over 730 days, dropping to three took the score's
 * spread DOWN (sd 9.1 -> 7.6) because the contacts it removed were the weak,
 * fast-moving ones. What creates movement is `LAYER_GAIN` and `RANK_DECAY`, not a
 * shorter list.
 */
export const TOP_ASPECT_LIMIT = 7;

export const MIN_ASPECT_SCORE = 3;

/**
 * Geometric decay applied down the ranked list, so the k-th strongest contact counts
 * `RANK_DECAY ** k`.
 *
 * A flat sum of seven contacts is an average in disguise: it takes fourteen numbers
 * that each move a little and adds them, and the central limit theorem does the rest.
 * Decaying the tail lets the one contact that is actually exact today set the tone
 * instead of being outvoted by six that have been in orb for a fortnight.
 */
export const RANK_DECAY = 0.85;
