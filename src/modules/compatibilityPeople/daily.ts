import { calculateDailyCompatibility } from "./aspects";
import { normalizeScore } from "./normalizer";
import { calibratePair } from "./pairCalibration";
import { DailyCompatibilityResult, NatalChart, TransitChart } from "./types";

export interface DailyScore {
    /** The blob stored on the score row, and what the aspects and the prompt are read from. */
    compatibility: DailyCompatibilityResult;
    /** 0-100, against this pair's own normal rather than against every pair in the world. */
    score: number;
}

export interface DailyScoreInput {
    readerChart: NatalChart;
    personChart: NatalChart;
    /**
     * `baseCompatibility.overall` — the pair's standing raw, which the day's transits
     * move around. Passed in rather than recomputed because every caller already has it
     * stored on the person.
     */
    baseOverall: number;
    transits: TransitChart;
}

/**
 * One day for one pair — the only place a compatibility score becomes a number.
 *
 * Four routes used to inline the same three lines (daily compatibility, add the base
 * raw, squash with a global normaliser), which is how that normaliser stayed a pair of
 * hand-written constants nobody owned. Anything about how a day is scored now changes
 * here.
 *
 * The raw is `base + modifier`, and `calibratePair` measures the median of exactly that
 * sum over a reference year. The two definitions have to agree or the pair is centred
 * on the wrong number, which is the one thing worth keeping in a single expression.
 */
export function scoreDay(input: DailyScoreInput): DailyScore {
    const compatibility = calculateDailyCompatibility(input.transits, input.readerChart, input.personChart);

    const calibration = calibratePair(input.readerChart, input.personChart);

    return {
        compatibility,
        score: normalizeScore(input.baseOverall + compatibility.modifier, calibration),
    };
}
