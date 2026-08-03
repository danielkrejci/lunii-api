import { readFile } from "node:fs/promises";

type BenchmarkResult = {
    tests: {
        overall: number;
        positive: number;
        negative: number;
        modifier: number;
        overallScore: number;
        aspectCount: number;
        strongestAspect?: number;
        weakestAspect?: number;
    }[];
};

async function main() {
    const text = await readFile("benchmark.ndjson", "utf8");

    const results: BenchmarkResult[] = text
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));

    console.log(`Results: ${results.length}\n`);

    const positives = results.map((r) => r.tests[0].positive);
    const negatives = results.map((r) => r.tests[0].negative);
    const overalls = results.map((r) => r.tests[0].overall);

    analyzeDistribution("positive", positives);
    analyzeDistribution("negative", negatives);
    analyzeDistribution("overall", overalls);

    console.log();
    console.log("========================================");
    console.log("SIGN ANALYSIS");
    console.log("========================================");

    analyzeSign("positive", positives);
    analyzeSign("negative", negatives);
    analyzeSign("overall", overalls);

    console.log();
    console.log("========================================");
    console.log("POSITIVE / NEGATIVE");
    console.log("========================================");

    console.table({
        avgPositive: average(positives),
        avgNegative: average(negatives),
        avgDifference: average(positives.map((p, i) => p - negatives[i])),
        avgRatio: average(positives.map((p, i) => (negatives[i] === 0 ? 0 : p / negatives[i]))),
    });

    console.log();
    console.log("========================================");
    console.log("ASPECT COUNT");
    console.log("========================================");

    analyzeDistribution(
        "aspectCount",
        results.map((r) => r.tests[0].aspectCount)
    );

    console.log();
    console.log("========================================");
    console.log("TOP 10");
    console.log("========================================");

    console.table(
        [...results]
            .sort((a, b) => b.tests[0].overall - a.tests[0].overall)
            .slice(0, 10)
            .map((r) => ({
                overall: r.tests[0].overall,
                positive: r.tests[0].positive,
                negative: r.tests[0].negative,
                aspectCount: r.tests[0].aspectCount,
            }))
    );

    console.log();
    console.log("========================================");
    console.log("BOTTOM 10");
    console.log("========================================");

    console.table(
        [...results]
            .sort((a, b) => a.tests[0].overall - b.tests[0].overall)
            .slice(0, 10)
            .map((r) => ({
                overall: r.tests[0].overall,
                positive: r.tests[0].positive,
                negative: r.tests[0].negative,
                aspectCount: r.tests[0].aspectCount,
            }))
    );

    console.log();
    console.log("========================================");
    console.log("ABSOLUTE MODIFIER");
    console.log("========================================");

    analyzeDistribution(
        "|modifier|",
        results.map((r) => Math.abs(r.tests[0].modifier))
    );

    console.log();
    console.log("========================================");
    console.log("CORRELATION");
    console.log("========================================");

    console.table({
        overall_modifier: correlation(
            overalls,
            results.map((r) => r.tests[0].modifier)
        ),

        overall_today: correlation(
            overalls,
            results.map((r) => r.tests[0].overallScore)
        ),
    });
}

function average(values: number[]) {
    return values.reduce((a, b) => a + b, 0) / values.length;
}

function analyzeSign(name: string, values: number[]) {
    const positive = values.filter((v) => v > 0).length;
    const negative = values.filter((v) => v < 0).length;
    const zero = values.filter((v) => v === 0).length;

    console.table({
        metric: name,
        positive,
        negative,
        zero,
        positivePct: ((positive / values.length) * 100).toFixed(1) + "%",
        negativePct: ((negative / values.length) * 100).toFixed(1) + "%",
    });
}

function analyzeDistribution(name: string, values: number[]) {
    values = [...values].sort((a, b) => a - b);

    console.table({
        metric: name,

        min: values[0],
        p1: percentile(values, 1),
        p5: percentile(values, 5),
        p10: percentile(values, 10),

        p25: percentile(values, 25),
        median: percentile(values, 50),
        p75: percentile(values, 75),

        p90: percentile(values, 90),
        p95: percentile(values, 95),
        p99: percentile(values, 99),

        max: values.at(-1),

        average: average(values),
    });
}

function percentile(values: number[], p: number) {
    const index = (p / 100) * (values.length - 1);

    const lower = Math.floor(index);
    const upper = Math.ceil(index);

    if (lower === upper) {
        return values[lower];
    }

    const weight = index - lower;

    return values[lower] * (1 - weight) + values[upper] * weight;
}

function correlation(a: number[], b: number[]) {
    const meanA = average(a);
    const meanB = average(b);

    let numerator = 0;
    let denominatorA = 0;
    let denominatorB = 0;

    for (let i = 0; i < a.length; i++) {
        const da = a[i] - meanA;
        const db = b[i] - meanB;

        numerator += da * db;
        denominatorA += da * da;
        denominatorB += db * db;
    }

    return numerator / Math.sqrt(denominatorA * denominatorB);
}

main().catch(console.error);
