/**
 * Identity of the scoring engine, stored on every row it produces.
 *
 * Six months from now `rules.ts` will have moved on, and recomputing an old row
 * will legitimately give a different number. That is not a bug — it is a different
 * engine. Without a version stamped on the row there is no way to tell the two
 * apart, and every historical score becomes unexplainable.
 *
 * Bump ENGINE_VERSION when any of these change:
 *   - rules.ts (baseImpact, importance, areas, priority)
 *   - overrides.ts
 *   - factors.ts (ASPECT_STRENGTH, LAYER_GAIN, SAMPLING_PENALTY, AREA_WEIGHTS)
 *   - the formula in buildImpacts()
 *   - the aspect geometry in astro/aspects.ts (MAX_ORBS, orbStrength)
 *   - the ephemeris source (lib/swisseph.ts), which changes the positions the
 *     whole engine reads from
 *
 * Format is the date plus a revision counter, because more than one change can
 * land on the same day and a bare date would then fail to tell rows apart.
 *
 * CALIBRATION_VERSION lives in calibration.ts and is written by the calibration
 * script, so it always matches the sample it was fitted from.
 */
export const ENGINE_VERSION = "2026-08-05.2";
