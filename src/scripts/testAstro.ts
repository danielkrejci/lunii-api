import {
    computeNatalChart,
    computeTransitChart,
    findTransitToNatalAspects,
    MAX_ORBS,
    NatalChart,
    NATAL_POINTS,
    transitInstantForDate,
} from "../modules/astro";

const BIRTH = {
    birthDate: "1990-06-15",
    birthTime: "14:30",
    birthPlaceLat: 50.0755,
    birthPlaceLng: 14.4378,
    timezone: "Europe/Prague",
};

console.log("=== 1. natal chart WITH birth time ===");
const withTime = computeNatalChart(BIRTH);
console.log("hasBirthTime:", withTime.hasBirthTime);
console.log("points:", Object.keys(withTime.chart).length, Object.keys(withTime.chart).join(", "));
console.log("sun:", withTime.chart.sun.sign, withTime.chart.sun.longitude.toFixed(3));
console.log("pluto:", withTime.chart.pluto.sign, "retro:", withTime.chart.pluto.retrograde);
console.log("ascendant:", withTime.chart.ascendant?.sign, withTime.chart.ascendant?.longitude.toFixed(3));

console.log("\n=== 2. natal chart WITHOUT birth time ===");
const withoutTime = computeNatalChart({ ...BIRTH, birthTime: null });
console.log("hasBirthTime:", withoutTime.hasBirthTime);
console.log("points:", Object.keys(withoutTime.chart).length);
console.log("ascendant:", withoutTime.chart.ascendant ?? "(absent, correct)");
console.log(
    "moon shift vs 14:30 chart:",
    Math.abs(withoutTime.chart.moon.longitude - withTime.chart.moon.longitude).toFixed(2),
    "deg"
);

console.log("\n=== 3. transit chart @ 00:00 UTC ===");
const transits = computeTransitChart(transitInstantForDate("2026-08-04"));
console.log("moon:", transits.moon.sign, transits.moon.longitude.toFixed(3), "speed:", transits.moon.speed?.toFixed(3));
console.log("saturn:", transits.saturn.sign, "retro:", transits.saturn.retrograde);

console.log("\n=== 4. transit -> natal aspects ===");
const hits = findTransitToNatalAspects(transits, withTime.chart);
console.log("hit count:", hits.length, "of", 10 * NATAL_POINTS.length, "possible pairs");
for (const hit of hits.slice(0, 8)) {
    console.log(
        `  transit ${hit.transit.padEnd(8)} ${hit.aspect.padEnd(11)} natal ${hit.natal.padEnd(9)}` +
            ` orb ${hit.orb.toFixed(2).padStart(5)}  strength ${hit.strength.toFixed(3)}  [${hit.group}]`
    );
}

const orbViolations = hits.filter((h) => h.orb > MAX_ORBS[h.aspect]);
const strengthViolations = hits.filter((h) => h.strength < 0 || h.strength > 1);
console.log("orb violations:", orbViolations.length, "| strength out of [0,1]:", strengthViolations.length);

console.log("\n=== 5. widened natal Moon orb (no birth time) ===");
const narrow = findTransitToNatalAspects(transits, withoutTime.chart);
const widened = findTransitToNatalAspects(transits, withoutTime.chart, { widenNatalMoon: true });
console.log("hits without widening:", narrow.length, "| with widening:", widened.length);

console.log("\n=== 6. determinism ===");
const again = findTransitToNatalAspects(transits, withTime.chart);
console.log("same input twice identical:", JSON.stringify(hits) === JSON.stringify(again));

// JSONB round-trips do not preserve key order; the engine must not care.
const reordered = Object.fromEntries(
    Object.entries(withTime.chart).sort((a, b) => b[0].localeCompare(a[0]))
) as NatalChart;
const fromReordered = findTransitToNatalAspects(transits, reordered);
console.log("key order independent:", JSON.stringify(hits) === JSON.stringify(fromReordered));

console.log("\n=== 7. aspect counts across 5 different natal charts ===");
for (const date of ["1955-03-02", "1968-11-21", "1979-07-09", "1990-06-15", "2003-01-27"]) {
    const chart = computeNatalChart({ ...BIRTH, birthDate: date }).chart;
    const personHits = findTransitToNatalAspects(transits, chart);
    const groups = personHits.reduce<Record<string, number>>((acc, h) => {
        acc[h.group] = (acc[h.group] ?? 0) + 1;
        return acc;
    }, {});
    console.log(`  ${date}: ${String(personHits.length).padStart(2)} hits`, JSON.stringify(groups));
}
