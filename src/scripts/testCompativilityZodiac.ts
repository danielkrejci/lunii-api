import dayjs from "dayjs";
import { eq } from "drizzle-orm";

import { db } from "../db";
import { transit } from "../db/schema";
import { calculateDailyCompatibility } from "../modules/compatibilityZodiac/scoring";
import { takeUniqueOrThrow } from "../utils/drizzleUtils";
import { ZodiacSign } from "../utils/natalUtils";

export interface Statistics {
    count: number;
    min: number;
    max: number;
    mean: number;
    median: number;
    stdDev: number;
    p5: number;
    p10: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
    p95: number;
}

export function calculateStatistics(values: number[]): Statistics {
    if (values.length === 0) {
        throw new Error("Values array is empty");
    }

    const sorted = [...values].sort((a, b) => a - b);

    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;

    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;

    const stdDev = Math.sqrt(variance);

    const percentile = (p: number): number => {
        const index = (sorted.length - 1) * p;
        const lower = Math.floor(index);
        const upper = Math.ceil(index);

        if (lower === upper) {
            return sorted[lower];
        }

        const weight = index - lower;

        return sorted[lower] * (1 - weight) + sorted[upper] * weight;
    };

    return {
        count: values.length,

        min: sorted[0],
        max: sorted.at(-1) ?? 0,

        mean,

        median: percentile(0.5),

        stdDev,

        p5: percentile(0.05),
        p10: percentile(0.1),
        p25: percentile(0.25),
        p50: percentile(0.5),
        p75: percentile(0.75),
        p90: percentile(0.9),
        p95: percentile(0.95),
    };
}

async function main() {
    const BASE_DATE = dayjs();

    const DAYS = 30;

    const SIGNS: ZodiacSign[] = [
        "taurus",
        "gemini",
        "cancer",
        "leo",
        "virgo",
        "libra",
        "scorpio",
        "sagittarius",
        "capricorn",
        "aquarius",
        "pisces",
    ];

    const result: {
        sign: ZodiacSign;
        score: number;
        rawScore: number;
    }[] = [];

    for (let i = -(DAYS / 2); i < DAYS / 2; i++) {
        const date = BASE_DATE.add(i, "day").format("YYYY-MM-DD");
        const transits = await db.select().from(transit).where(eq(transit.date, date)).then(takeUniqueOrThrow);

        for (const sign of SIGNS) {
            const { score, rawScore } = calculateDailyCompatibility(sign, "pisces", transits.planets);
            result.push({
                sign,
                score,
                rawScore,
            });
        }
    }

    const stats = calculateStatistics(result.map(({ rawScore }) => rawScore));

    console.table(stats);

    console.table(result.sort((a, b) => a.score - b.score));
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
