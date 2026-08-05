import { DirectionOverride } from "./types";

/**
 * Direction-specific corrections on top of the unordered AspectRule table.
 *
 * Only add an entry where the DIRECTION changes the meaning, not merely the
 * magnitude — magnitude is already handled by LAYER_GAIN and SAMPLING_PENALTY.
 *
 * Example of a genuine case: transit Saturn conjunct natal Moon is a lasting
 * emotional weight, while transit Moon conjunct natal Saturn is a passing brush
 * with one's own limits. Same pair, different area emphasis and a different story.
 *
 *   {
 *       transit: "saturn",
 *       natal: "moon",
 *       group: "conjunction",
 *       areas: { mood: 0.5, health: 0.3, love: 0.2 },
 *       title: "Emotional Weight",
 *       description: "...",
 *   }
 *
 * Deliberately empty: every entry is an astrological judgement and belongs in a
 * review, not in a generated default.
 */
export const DIRECTION_OVERRIDES: DirectionOverride[] = [];
