/**
 * Recomputes stored natal charts to the current 11-point shape.
 *
 * Charts written before the chart was widened hold 7 planets and no Ascendant. The
 * scoring engine skips missing points silently, so those users get fewer aspects,
 * a lower confidence and a score built on a fraction of the input — with no error
 * anywhere. Everything needed to rebuild them (birth date, time, coordinates,
 * timezone) is already stored.
 *
 *   pnpm tsx src/scripts/recomputeNatalCharts.ts          # dry run, writes nothing
 *   pnpm tsx src/scripts/recomputeNatalCharts.ts --write
 *
 * Also refreshes rising_sign from the recomputed Ascendant, which becomes null when
 * the birth time is unknown. That requires migration 0022 (rising_sign DROP NOT NULL).
 */
import { eq, sql } from "drizzle-orm";

import { db, pool } from "../db";
import { compatibilityPeople, profile } from "../db/schema";
import { computeNatalChart, NATAL_POINTS } from "../modules/astro";
import { ZodiacSign } from "../utils/natalUtils";

const write = process.argv.includes("--write");

/* ============================================================
   PRECONDITION
============================================================ */

const risingNullable = await db.execute(sql`
    select is_nullable from information_schema.columns
    where table_name = 'profile' and column_name = 'rising_sign'
`);

const canNullRising = risingNullable.rows[0]?.is_nullable === "YES";

if (!canNullRising) {
    console.warn("WARNING: profile.rising_sign is still NOT NULL — migration 0022 has not been applied.");
    console.warn("         Charts can still be rebuilt, but rising_sign cannot be cleared for");
    console.warn("         profiles without a birth time. Run pnpm db:migrate first.\n");
}

/* ============================================================
   PROFILES
============================================================ */

const profiles = await db
    .select({
        userId: profile.userId,
        birthDate: profile.birthDate,
        birthTime: profile.birthTime,
        birthPlaceLat: profile.birthPlaceLat,
        birthPlaceLng: profile.birthPlaceLng,
        timezone: profile.timezone,
        risingSign: profile.risingSign,
        birthChart: profile.birthChart,
    })
    .from(profile);

console.log(`profile: ${profiles.length} rows`);

let profilesChanged = 0;
let profilesSkipped = 0;

for (const row of profiles) {
    const before = Object.keys(row.birthChart ?? {}).length;

    let recomputed;

    try {
        recomputed = computeNatalChart({
            birthDate: row.birthDate,
            birthTime: row.birthTime,
            birthPlaceLat: row.birthPlaceLat,
            birthPlaceLng: row.birthPlaceLng,
            timezone: row.timezone,
        });
    } catch (error) {
        console.error(`  FAIL  ${row.userId.slice(0, 12)}…  ${error instanceof Error ? error.message : error}`);
        profilesSkipped++;
        continue;
    }

    const after = Object.keys(recomputed.chart).length;
    const nextRising = (recomputed.chart.ascendant?.sign as ZodiacSign | undefined) ?? null;
    const risingChanges = nextRising !== row.risingSign;

    if (before === after && !risingChanges) {
        continue;
    }

    console.log(
        `  ${row.userId.slice(0, 12)}…  points ${before} -> ${after}` +
            `  ascendant=${recomputed.chart.ascendant ? recomputed.chart.ascendant.sign : "none"}` +
            `  rising ${row.risingSign ?? "null"} -> ${nextRising ?? "null"}` +
            `${row.birthTime === null ? "  (no birth time)" : ""}`
    );

    if (write) {
        await db
            .update(profile)
            .set({
                birthChart: recomputed.chart,
                // Leave the old value in place if the column cannot hold null yet.
                ...(nextRising === null && !canNullRising ? {} : { risingSign: nextRising }),
            })
            .where(eq(profile.userId, row.userId));
    }

    profilesChanged++;
}

/* ============================================================
   COMPATIBILITY PEOPLE
============================================================ */

const people = await db
    .select({
        id: compatibilityPeople.id,
        birthDate: compatibilityPeople.birthDate,
        birthTime: compatibilityPeople.birthTime,
        birthPlaceLat: compatibilityPeople.birthPlaceLat,
        birthPlaceLng: compatibilityPeople.birthPlaceLng,
        timezone: compatibilityPeople.timezone,
        risingSign: compatibilityPeople.risingSign,
        birthChart: compatibilityPeople.birthChart,
    })
    .from(compatibilityPeople);

console.log(`\ncompatibility_people: ${people.length} rows`);

let peopleChanged = 0;

for (const row of people) {
    const before = Object.keys(row.birthChart ?? {}).length;

    let recomputed;

    try {
        recomputed = computeNatalChart({
            birthDate: row.birthDate,
            birthTime: row.birthTime,
            birthPlaceLat: row.birthPlaceLat,
            birthPlaceLng: row.birthPlaceLng,
            // Falls back to UTC: these rows may predate the timezone column.
            timezone: row.timezone ?? "UTC",
        });
    } catch (error) {
        console.error(`  FAIL  ${row.id.slice(0, 12)}…  ${error instanceof Error ? error.message : error}`);
        continue;
    }

    const after = Object.keys(recomputed.chart).length;
    const nextRising = (recomputed.chart.ascendant?.sign as ZodiacSign | undefined) ?? null;

    if (before === after && nextRising === row.risingSign) {
        continue;
    }

    console.log(
        `  ${row.id.slice(0, 12)}…  points ${before} -> ${after}  rising ${row.risingSign ?? "null"} -> ${nextRising ?? "null"}`
    );

    if (write) {
        await db
            .update(compatibilityPeople)
            .set({ birthChart: recomputed.chart, risingSign: nextRising })
            .where(eq(compatibilityPeople.id, row.id));
    }

    peopleChanged++;
}

/* ============================================================
   SUMMARY
============================================================ */

console.log(
    `\n${write ? "WROTE" : "DRY RUN"} — profile: ${profilesChanged} to change` +
        `${profilesSkipped > 0 ? ` (${profilesSkipped} failed)` : ""}` +
        `, compatibility_people: ${peopleChanged} to change`
);
console.log(`engine expects ${NATAL_POINTS.length} points (10 planets + Ascendant when the birth time is known)`);

if (!write) {
    console.log("\nNothing was written. Re-run with --write to apply.");
}

await pool.end();
