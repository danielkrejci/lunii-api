import { NormalizerConfig } from "./types";

/**
 * Squashes an unbounded raw sum onto 0-100 with a logistic curve.
 *
 * `median` is the raw value that maps to 50 and `sigma` the raw spread that maps to
 * roughly ±23 points. Both come from a fit, never from a guess: see ./calibration.ts
 * for the cross-pair constants and ./pairCalibration.ts for the per-pair median.
 */
export function normalizeScore(raw: number, config: NormalizerConfig): number {
    const { median, sigma } = config;

    const normalized = 100 / (1 + Math.exp(-(raw - median) / sigma));

    return Math.round(Math.max(0, Math.min(100, normalized)));
}
