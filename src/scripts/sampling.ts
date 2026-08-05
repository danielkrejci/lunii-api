/**
 * Shared deterministic sampling for the daily-score scripts.
 *
 * Calibration and analysis must describe the SAME sample, otherwise the report
 * talks about a different engine than the one the constants were fitted to.
 */
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";

import { computeNatalChart, computeTransitChart, NatalChart, TransitChart } from "../modules/astro";

dayjs.extend(utc);

export const SEED = 0x5eed_1e55;

/** First day of the sampled transit window. */
export const SAMPLE_START = "2025-01-01";

// `>>> 0` is uint32 wrap-around, which is the whole point of the generator.
// Math.trunc() would not wrap and would break reproducibility.
// oxlint-disable unicorn/prefer-math-trunc
export function mulberry32(seed: number): () => number {
    let state = seed >>> 0;

    return () => {
        state = (state + 0x6d_2b_79_f5) >>> 0;

        let t = state;

        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

        return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    };
}
// oxlint-enable unicorn/prefer-math-trunc

export const CITIES: { lat: number; lng: number; timezone: string }[] = [
    { lat: 50.0755, lng: 14.4378, timezone: "Europe/Prague" },
    { lat: 51.5074, lng: -0.1278, timezone: "Europe/London" },
    { lat: 40.7128, lng: -74.006, timezone: "America/New_York" },
    { lat: 34.0522, lng: -118.2437, timezone: "America/Los_Angeles" },
    { lat: -23.5505, lng: -46.6333, timezone: "America/Sao_Paulo" },
    { lat: 48.8566, lng: 2.3522, timezone: "Europe/Paris" },
    { lat: 55.7558, lng: 37.6173, timezone: "Europe/Moscow" },
    { lat: 28.6139, lng: 77.209, timezone: "Asia/Kolkata" },
    { lat: 35.6762, lng: 139.6503, timezone: "Asia/Tokyo" },
    { lat: 1.3521, lng: 103.8198, timezone: "Asia/Singapore" },
    { lat: -33.8688, lng: 151.2093, timezone: "Australia/Sydney" },
    { lat: 30.0444, lng: 31.2357, timezone: "Africa/Cairo" },
    { lat: -1.2921, lng: 36.8219, timezone: "Africa/Nairobi" },
    { lat: 19.4326, lng: -99.1332, timezone: "America/Mexico_City" },
    { lat: 41.0082, lng: 28.9784, timezone: "Europe/Istanbul" },
    { lat: 59.3293, lng: 18.0686, timezone: "Europe/Stockholm" },
];

export interface Subject {
    chart: NatalChart;
    hasBirthTime: boolean;
}

export function sampleSubjects(count: number, random: () => number): Subject[] {
    const subjects: Subject[] = [];

    for (let index = 0; index < count; index++) {
        const city = CITIES[Math.floor(random() * CITIES.length)];

        // Birth dates spanning roughly the plausible user base.
        const year = 1955 + Math.floor(random() * 55);
        const month = 1 + Math.floor(random() * 12);
        const day = 1 + Math.floor(random() * 28);

        // A fifth of users never enter a birth time.
        const knowsTime = random() > 0.2;

        const hour = Math.floor(random() * 24);
        const minute = Math.floor(random() * 60);

        const { chart, hasBirthTime } = computeNatalChart({
            birthDate: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
            birthTime: knowsTime ? `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` : null,
            birthPlaceLat: city.lat,
            birthPlaceLng: city.lng,
            timezone: city.timezone,
        });

        subjects.push({ chart, hasBirthTime });
    }

    return subjects;
}

/** Transit charts are shared across all subjects — compute each day once. */
export function sampleTransitCharts(dayCount: number): TransitChart[] {
    const start = dayjs.utc(SAMPLE_START);

    return Array.from({ length: dayCount }, (_, offset) => computeTransitChart(start.add(offset, "day").toDate()));
}

export function buildSample(chartCount: number, dayCount: number) {
    return {
        subjects: sampleSubjects(chartCount, mulberry32(SEED)),
        transitCharts: sampleTransitCharts(dayCount),
    };
}

/* ============================================================
   STATISTICS
============================================================ */

export function percentile(sorted: number[], fraction: number): number {
    if (sorted.length === 0) {
        return 0;
    }

    const position = Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))));

    return sorted[position];
}

export function median(values: number[]): number {
    return percentile(
        [...values].sort((a, b) => a - b),
        0.5
    );
}

export function mean(values: number[]): number {
    return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

export function describe(values: number[]): string {
    const sorted = [...values].sort((a, b) => a - b);

    return (
        `mean ${mean(values).toFixed(1)}  p10 ${percentile(sorted, 0.1).toFixed(1)}  ` +
        `p50 ${percentile(sorted, 0.5).toFixed(1)}  p90 ${percentile(sorted, 0.9).toFixed(1)}  ` +
        `min ${sorted[0].toFixed(1)}  max ${sorted.at(-1).toFixed(1)}`
    );
}

export function histogram(values: number[]): string {
    const buckets: number[] = Array.from({ length: 10 }, () => 0);

    for (const value of values) {
        buckets[Math.min(9, Math.floor(value / 10))]++;
    }

    const peak = Math.max(...buckets);

    return buckets
        .map((count, index) => {
            const bar = "#".repeat(Math.round((count / peak) * 40));
            const share = ((count / values.length) * 100).toFixed(1);

            return `  ${String(index * 10).padStart(3)}-${String(index * 10 + 9).padEnd(3)} ${share.padStart(5)}%  ${bar}`;
        })
        .join("\n");
}

export function argValue(name: string, fallback: number): number {
    const index = process.argv.indexOf(`--${name}`);

    return index === -1 ? fallback : Number(process.argv[index + 1]);
}
