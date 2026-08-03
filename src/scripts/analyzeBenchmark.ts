import { readFile } from "node:fs/promises";

type BenchmarkResult = {
    overallRaw: number;
    modifier: number;
    compatibility: number;
};

const BUCKET_SIZE = 10;

async function main() {
    const text = await readFile("benchmark.ndjson", "utf8");

    const results: BenchmarkResult[] = text
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));

    analyze(
        "overallRaw",
        results.map((r) => r.overallRaw)
    );
    analyze(
        "modifier",
        results.map((r) => r.modifier)
    );
    analyze(
        "compatibility",
        results.map((r) => r.compatibility)
    );
}

function analyze(name: string, values: number[]) {
    values.sort((a, b) => a - b);

    const avg = values.reduce((a, b) => a + b, 0) / values.length;

    const histogram = new Map<number, number>();

    for (const value of values) {
        const bucket = Math.floor(value / BUCKET_SIZE) * BUCKET_SIZE;

        histogram.set(bucket, (histogram.get(bucket) ?? 0) + 1);
    }

    console.log();
    console.log("========================================");
    console.log(name);
    console.log("========================================");

    console.table({
        count: values.length,
        min: values[0],
        p5: percentile(values, 5),
        p25: percentile(values, 25),
        median: percentile(values, 50),
        p75: percentile(values, 75),
        p95: percentile(values, 95),
        max: values.at(-1),
        average: avg,
    });

    console.log();
    console.log("Histogram:");

    const rows = [...histogram.entries()].sort((a, b) => a[0] - b[0]);

    console.table(
        rows.map(([bucket, count]) => ({
            range: `${bucket}..${bucket + BUCKET_SIZE}`,
            count,
        }))
    );
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

main().catch(console.error);
