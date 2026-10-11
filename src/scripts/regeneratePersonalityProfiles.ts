/**
 * Rewrites every stored personality profile in the current shape: the Cosmic Overview
 * in `personality_profile` and the private analysis in `personality_context`.
 *
 * Profiles written before the overview existed hold the old three-section prose, which
 * the profile screen no longer reads, and have no context at all, so every prompt reads
 * them without one. Everything the generation needs is already stored on the profile.
 *
 *   pnpm tsx src/scripts/regeneratePersonalityProfiles.ts                 # dry run, calls nothing
 *   pnpm tsx src/scripts/regeneratePersonalityProfiles.ts --write
 *   pnpm tsx src/scripts/regeneratePersonalityProfiles.ts --write --only-missing
 *   pnpm tsx src/scripts/regeneratePersonalityProfiles.ts --write --user=<userId>
 *
 * Each profile is one paid model call (~$0.006, ~10 s). A failed generation leaves that
 * profile untouched — the same rule the profile update follows — and is listed at the end.
 * Requires migration 0037 (profile.personality_context).
 */
import { eq, isNull, sql } from "drizzle-orm";
import { FastifyInstance } from "fastify";

import { db, pool } from "../db";
import { profile } from "../db/schema";
import { generatePersonalityProfile } from "../modules/personality/generate";

const write = process.argv.includes("--write");
const onlyMissing = process.argv.includes("--only-missing");
const userId = process.argv.find((arg) => arg.startsWith("--user="))?.slice("--user=".length);

/** Parallel calls. Low on purpose: the rate limit is shared with the running API. */
const CONCURRENCY = 3;

/* ============================================================
   PRECONDITION
============================================================ */

const column = await db.execute(sql`
    select 1 from information_schema.columns
    where table_name = 'profile' and column_name = 'personality_context'
`);

if (column.rows.length === 0) {
    console.error("profile.personality_context does not exist — run the migrations first.");
    await pool.end();
    process.exit(1);
}

/* ============================================================
   PROFILES
============================================================ */

const where = userId ? eq(profile.userId, userId) : onlyMissing ? isNull(profile.personalityContext) : undefined;

const profiles = await db.select().from(profile).where(where);

console.log(
    `profile: ${profiles.length} rows${onlyMissing ? " without a context" : ""}${userId ? ` for ${userId}` : ""}`
);

if (!write) {
    for (const row of profiles) {
        console.log(`  would rewrite  ${row.userId.slice(0, 12)}…  ${row.language}  ${row.sunSign}`);
    }

    console.log(`\nDry run. Estimated cost ~$${(profiles.length * 0.006).toFixed(2)}. Pass --write to generate.`);
    await pool.end();
    process.exit(0);
}

/** What `generatePersonalityProfile` uses of Fastify: the database for its audit row, and a logger. */
const fastify = { db, log: console } as unknown as FastifyInstance;

const failed: string[] = [];
let written = 0;
let next = 0;

async function worker() {
    while (next < profiles.length) {
        const row = profiles[next++];

        try {
            const result = await generatePersonalityProfile(fastify, {
                userId: row.userId,
                chart: row.birthChart,
                hasBirthTime: row.birthTime !== null,
                sunSign: row.sunSign,
                relationshipStatus: row.relationshipStatus,
                careerStage: row.careerStage,
                decisionStyle: row.decisionStyle,
                areasOfInterest: row.areasOfInterest,
                contentPreference: row.contentPreference,
                beliefLevel: row.beliefLevel,
                languageIso: row.language,
                gender: row.gender,
            });

            if (!result.context) {
                throw new Error("unusable answer twice");
            }

            await db
                .update(profile)
                .set({
                    personalityProfile: JSON.stringify(result.overview),
                    personalityContext: result.context,
                    personalityProfileInput: result.input,
                })
                .where(eq(profile.id, row.id));

            written++;
            console.log(`  ok    ${row.userId.slice(0, 12)}…  ${result.overview.signature.summary.length} paragraphs`);
        } catch (error) {
            failed.push(row.userId);
            console.error(`  FAIL  ${row.userId.slice(0, 12)}…  ${error instanceof Error ? error.message : error}`);
        }
    }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

console.log(`\nwritten: ${written}, failed: ${failed.length}`);

if (failed.length > 0) {
    console.log(
        `Retry the failures with --only-missing, or one by one:\n${failed.map((id) => `  --user=${id}`).join("\n")}`
    );
}

await pool.end();
