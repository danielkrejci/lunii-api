import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";

import { computeTransitChart } from "../astro";
import { calculateCompatibility, calculateDailyCompatibility } from "./aspects";
import { DAILY_SIGMA } from "./calibration";
import { NormalizerConfig, NatalChart, TransitChart } from "./types";

dayjs.extend(utc);

/**
 * Where the reference year starts, and how long it is.
 *
 * A fixed window rather than a rolling one, so a pair's baseline is a property of the
 * two charts and nothing else — it must not drift because the calibration happened to
 * run in March. A year is the right length: the Moon and all four of the other bodies
 * that reach the transit scorer cycle within it, and Jupiter and Saturn — the two that
 * would make one year differ from the next — are dropped before scoring.
 *
 * Sampled at UTC midnight, not at anybody's local noon. The half-day difference moves
 * the Moon by about 6.6°, which changes individual days but not the median of 365 of
 * them, and it keeps a pair's baseline from shifting when one of them travels.
 */
const REFERENCE_START = "2025-01-01";
const REFERENCE_DAYS = 365;

let referenceTransits: TransitChart[] | null = null;

/** ~14 ms of ephemeris, shared by every pair for the life of the process. */
function getReferenceTransits(): TransitChart[] {
    if (!referenceTransits) {
        const start = dayjs.utc(REFERENCE_START);

        referenceTransits = Array.from(
            { length: REFERENCE_DAYS },
            (_, offset) => computeTransitChart(start.add(offset, "day").toDate()) as TransitChart
        );
    }

    return referenceTransits;
}

/* ============================================================
   CACHE
============================================================ */

/**
 * Bounded, because the key space is every pair every user has saved. Insertion order
 * is eviction order — a plain FIFO, not an LRU: the access pattern here is "one user
 * opens their list, then one of the people on it", so recency and insertion agree
 * closely enough that tracking hits is not worth the bookkeeping.
 */
const CACHE_LIMIT = 500;

const cache = new Map<string, NormalizerConfig>();

/**
 * Cheap identity for a chart pair. Longitudes to a tenth of a degree: finer than any
 * difference that survives to the median of a year, and coarse enough that a chart
 * recomputed from the same birth data lands on the same key.
 */
function fingerprint(chart: NatalChart): string {
    return Object.values(chart)
        .map((position) => position.longitude.toFixed(1))
        .join(",");
}

/* ============================================================
   CALIBRATION
============================================================ */

/**
 * Where this pair's own daily raw score sits, and how wide to open the squash around
 * it.
 *
 * The global normaliser this replaced asked "how does today for these two compare to
 * every pair in the world", and answered it with one hardcoded midpoint. That is the
 * wrong question for a number labelled today: a pair whose standing chart is quiet
 * scored in the forties every single day of the year and a strong pair in the
 * seventies, and neither could tell a good day from a bad one — measured on a real
 * pair, 90 % of days landed inside 31-61.
 *
 * Recentring on the pair's own median makes 50 mean "an ordinary day for the two of
 * you", which is the only reading of a daily number that carries information. Nothing
 * is lost by it: how compatible they are overall is `baseScore`, sits on the same
 * screen, and is where that comparison belongs.
 *
 * Sigma stays global. Fitting it per pair as well would standardise every pair onto an
 * identical distribution and erase a real difference — some charts genuinely catch
 * more traffic from the sky than others — so DAILY_SIGMA is fitted across the cohort
 * on deviations from each pair's own median, and a turbulent pair keeps its turbulence.
 */
export function calibratePair(readerChart: NatalChart, personChart: NatalChart): NormalizerConfig {
    const key = `${fingerprint(readerChart)}|${fingerprint(personChart)}`;

    const cached = cache.get(key);

    if (cached) {
        return cached;
    }

    const base = calculateCompatibility(readerChart, personChart);

    const raws = getReferenceTransits().map(
        (transits) => base.overall + calculateDailyCompatibility(transits, readerChart, personChart).modifier
    );

    raws.sort((a, b) => a - b);

    const config: NormalizerConfig = {
        median: raws[Math.floor(raws.length / 2)],
        sigma: DAILY_SIGMA,
    };

    if (cache.size >= CACHE_LIMIT) {
        const oldest = cache.keys().next();

        if (!oldest.done) {
            cache.delete(oldest.value);
        }
    }

    cache.set(key, config);

    return config;
}

/** Test seam. The reference transits are deliberately not cleared — they never change. */
export function clearPairCalibrationCache(): void {
    cache.clear();
}
