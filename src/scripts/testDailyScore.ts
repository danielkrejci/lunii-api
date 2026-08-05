import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";

import {
    computeNatalChart,
    computeTransitChart,
    LIFE_AREAS,
    LifeArea,
    NatalChart,
    transitInstantForDate,
} from "../modules/astro";
import { calculateDailyScore } from "../modules/dailyScore";

dayjs.extend(utc);

const PRAGUE = { birthPlaceLat: 50.0755, birthPlaceLng: 14.4378, timezone: "Europe/Prague" };

const PEOPLE = [
    { name: "A", birthDate: "1955-03-02", birthTime: "07:15" },
    { name: "B", birthDate: "1968-11-21", birthTime: "23:40" },
    { name: "C", birthDate: "1979-07-09", birthTime: "12:00" },
    { name: "D", birthDate: "1990-06-15", birthTime: "14:30" },
    { name: "E", birthDate: "2003-01-27", birthTime: null },
];

const subjects = PEOPLE.map((person) => {
    const { chart, hasBirthTime } = computeNatalChart({ ...PRAGUE, ...person });

    return { name: person.name, chart, hasBirthTime };
});

const DATE = "2026-08-04";
const transits = computeTransitChart(transitInstantForDate(DATE));

console.log(`=== 1. same day (${DATE}), five different natal charts ===`);
console.log("           love career health mood overall  conf  impacts");

for (const subject of subjects) {
    const { scores, confidence, impacts } = calculateDailyScore({
        natal: subject.chart,
        transits,
        hasBirthTime: subject.hasBirthTime,
    });

    console.log(
        `  ${subject.name}${subject.hasBirthTime ? " " : "*"}       ` +
            `${String(scores.loveScore).padStart(4)}` +
            `${String(scores.careerScore).padStart(7)}` +
            `${String(scores.healthScore).padStart(7)}` +
            `${String(scores.moodScore).padStart(5)}` +
            `${String(scores.overallScore).padStart(8)}` +
            `  ${confidence.toFixed(2)}` +
            `  ${String(impacts.length).padStart(3)}`
    );
}
console.log("  * no birth time");

console.log(`\n=== 2. same chart (D), fourteen consecutive days ===`);
console.log("  date        love career health mood overall");

for (let offset = 0; offset < 14; offset++) {
    const date = dayjs.utc(DATE).add(offset, "day").format("YYYY-MM-DD");
    const dayTransits = computeTransitChart(transitInstantForDate(date));
    const { scores } = calculateDailyScore({ natal: subjects[3].chart, transits: dayTransits, hasBirthTime: true });

    console.log(
        `  ${date}${String(scores.loveScore).padStart(6)}${String(scores.careerScore).padStart(7)}` +
            `${String(scores.healthScore).padStart(7)}${String(scores.moodScore).padStart(5)}` +
            `${String(scores.overallScore).padStart(8)}`
    );
}

console.log(`\n=== 3. breakdown for D on ${DATE} ===`);
const detail = calculateDailyScore({ natal: subjects[3].chart, transits, hasBirthTime: true });

console.log(`  raw: ${LIFE_AREAS.map((area) => `${area} ${detail.raw[area].toFixed(2)}`).join("  ")}`);
console.log(`  raw overall: ${detail.raw.overall.toFixed(2)}   confidence: ${detail.confidence}`);
console.log(`  coveredWeight: ${detail.coveredWeight.toFixed(2)}   unresolved: ${detail.unresolved.length}`);

console.log("\n  top impacts by narrative priority:");
for (const impact of detail.breakdown.top) {
    console.log(
        `    p${impact.priority}  ${impact.area.padEnd(7)} ${impact.value >= 0 ? "+" : ""}${impact.value.toFixed(2).padStart(6)}` +
            `  ${impact.reason.padEnd(44)} (${impact.title})`
    );
}

console.log("\n  strongest love contributions:");
for (const impact of detail.breakdown.byArea.love.positive) {
    console.log(`    +${impact.value.toFixed(2).padStart(5)}  ${impact.reason}`);
}
for (const impact of detail.breakdown.byArea.love.negative) {
    console.log(`    ${impact.value.toFixed(2).padStart(6)}  ${impact.reason}`);
}

console.log("\n=== 4. determinism ===");
const again = calculateDailyScore({ natal: subjects[3].chart, transits, hasBirthTime: true });
console.log("  identical on repeat:", JSON.stringify(detail) === JSON.stringify(again));

const reordered = Object.fromEntries(
    Object.entries(subjects[3].chart).sort((a, b) => b[0].localeCompare(a[0]))
) as NatalChart;
const fromReordered = calculateDailyScore({ natal: reordered, transits, hasBirthTime: true });
console.log("  independent of chart key order:", JSON.stringify(detail) === JSON.stringify(fromReordered));

console.log("\n=== 5. areas are independent (no max-normalisation) ===");
const maxCounts: Record<LifeArea, number> = { love: 0, career: 0, health: 0, mood: 0 };
const pinnedTo100: Record<LifeArea, number> = { love: 0, career: 0, health: 0, mood: 0 };
let sanityFailures = 0;

for (let offset = 0; offset < 365; offset++) {
    const date = dayjs.utc("2026-01-01").add(offset, "day");
    const dayTransits = computeTransitChart(date.toDate());
    const { scores } = calculateDailyScore({ natal: subjects[3].chart, transits: dayTransits, hasBirthTime: true });

    const byArea: Record<LifeArea, number> = {
        love: scores.loveScore,
        career: scores.careerScore,
        health: scores.healthScore,
        mood: scores.moodScore,
    };

    for (const area of LIFE_AREAS) {
        if (byArea[area] === 100) {
            pinnedTo100[area]++;
        }
    }

    const best = LIFE_AREAS.reduce((winner, area) => (byArea[area] > byArea[winner] ? area : winner), LIFE_AREAS[0]);
    maxCounts[best]++;

    for (const value of [...Object.values(byArea), scores.overallScore]) {
        if (!Number.isInteger(value) || value < 0 || value > 100 || Number.isNaN(value)) {
            sanityFailures++;
        }
    }
}

console.log("  which area is highest, over 365 days:", JSON.stringify(maxCounts));
console.log("  days where an area hit exactly 100:", JSON.stringify(pinnedTo100));
console.log("  out-of-range or non-integer scores:", sanityFailures);
