import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { FastifyInstance } from "fastify";

import { aiGenerations, compatibilityPeopleScores, profile as profileTable } from "../../db/schema";
import { runInBackground } from "../../lib/backgroundTasks";
import { Gender, Relationship, ZodiacSign } from "../../utils/natalUtils";
import { creditKeys } from "../credits/keys";
import { refundUnlock } from "../credits/service";
import { generateCompatibilityInsight } from "./ai";
import { dailyContacts } from "./contacts";
import { DailyCompatibilityResult } from "./types";

/**
 * Writing a pair's daily reading, as a thing the server does rather than a thing one
 * route does.
 *
 * Two callers need it: the detail that starts a day, and the person update, which
 * rewrites the reading straight away when the birth data it was written from changed.
 * Leaving it in the detail route would have meant one route importing another.
 */

/** What the prompt needs to know about the person and their day. */
export interface CompatibilityGenerationTarget {
    id: string;
    name: string;
    gender: Gender;
    relationship: Relationship;
    sign: ZodiacSign;
    score: number;
    compatibility: DailyCompatibilityResult;
}

/**
 * Claims the day for this person and, if the claim succeeds, writes the reading.
 *
 * Same shape as the daily insight: one statement decides who pays for the model, the
 * work itself runs detached, and every write carries the claimed timestamp so a run
 * whose row has moved on cannot overwrite it. The key is (person, date) rather than
 * (user, date) — ownership was already checked by the caller.
 */
export async function startCompatibilityGeneration(
    fastify: FastifyInstance,
    input: {
        person: CompatibilityGenerationTarget;
        /** The reader's stored profile: the reading is written to them. */
        profile: typeof profileTable.$inferSelect;
        date: string;
        allowFailed: boolean;
    }
): Promise<void> {
    const { person, profile, date } = input;

    const [claimed] = await fastify.db
        .update(compatibilityPeopleScores)
        // Milliseconds, because the timestamp has to survive a round trip through a JS
        // `Date`; full `now()` precision would come back short and match no row.
        .set({ status: "pending", updatedAt: sql`date_trunc('milliseconds', now())` })
        .where(
            and(
                eq(compatibilityPeopleScores.personId, person.id),
                eq(compatibilityPeopleScores.date, date),
                isNull(compatibilityPeopleScores.content),
                or(
                    eq(compatibilityPeopleScores.status, "absent"),
                    input.allowFailed ? eq(compatibilityPeopleScores.status, "failed") : sql`false`,
                    and(
                        eq(compatibilityPeopleScores.status, "pending"),
                        lt(compatibilityPeopleScores.updatedAt, sql`now() - interval '5 minutes'`)
                    )
                )
            )
        )
        .returning({ updatedAt: compatibilityPeopleScores.updatedAt });

    if (!claimed) {
        return;
    }

    runInBackground(
        async () => {
            const owned = and(
                eq(compatibilityPeopleScores.personId, person.id),
                eq(compatibilityPeopleScores.date, date),
                eq(compatibilityPeopleScores.updatedAt, claimed.updatedAt)
            );

            // One retry: most failures here are a timeout or a rate limit rather than
            // anything a second attempt would hit again.
            for (let attempt = 1; attempt <= 2; attempt++) {
                const { content, usage } = await generateCompatibilityInsight(profile.language, {
                    score: person.score,
                    modifier: person.compatibility.modifier,

                    positiveTotal: person.compatibility.positiveOverall,
                    negativeTotal: person.compatibility.negativeOverall,

                    breakdown: person.compatibility.overallBreakdown,

                    // The same list the response carries, so the captions the model writes
                    // land on exactly the aspects shown underneath the text.
                    contacts: dailyContacts(person.compatibility),

                    relationshipType: person.relationship,

                    // The stored row satisfies Reader structurally, so nothing has to be
                    // picked apart here and forgotten when a field is added.
                    reader: profile,

                    personA: { name: profile.name, gender: profile.gender, sunSign: profile.sunSign },
                    personB: { name: person.name, gender: person.gender, sunSign: person.sign },
                });

                await fastify.db
                    .insert(aiGenerations)
                    .values({
                        userId: profile.userId,
                        type: "compatibilityPeople",
                        status: content ? "success" : "error",
                        error: usage.error,
                        requestId: usage.requestId,
                        provider: usage.provider,
                        model: usage.model,
                        input: usage.input,
                        output: usage.output,
                        inputTokens: usage.inputTokens,
                        outputTokens: usage.outputTokens,
                        total_tokens: usage.totalTokens,
                        latencyMs: usage.latencyMs,
                        cost: usage.cost,
                    })
                    .catch((error: unknown) =>
                        fastify.log.error({ err: error, personId: person.id, date }, "Failed to log AI generation")
                    );

                if (content) {
                    const written = await fastify.db
                        .update(compatibilityPeopleScores)
                        .set({ content, status: "ready", updatedAt: sql`date_trunc('milliseconds', now())` })
                        .where(owned)
                        .returning({ date: compatibilityPeopleScores.date });

                    if (written.length === 0) {
                        fastify.log.warn(
                            { personId: person.id, date },
                            "Generated reading discarded, the row had moved on"
                        );
                    }

                    return;
                }
            }

            const failed = await fastify.db
                .update(compatibilityPeopleScores)
                .set({ status: "failed", updatedAt: sql`date_trunc('milliseconds', now())` })
                .where(owned)
                .returning({ date: compatibilityPeopleScores.date });

            /**
             * Give the credits back, and revoke the unlock with them. Guarded on the update
             * having matched, so only the run that owned this row refunds; `refundUnlock`
             * deletes and returns exactly once, so the sweeper racing it gives back nothing.
             */
            if (failed.length > 0) {
                await refundUnlock(fastify.db, {
                    // The reader who paid, not the person the reading is about.
                    userId: profile.userId,
                    feature: "compatibilityDetail",
                    resourceKey: creditKeys.compatibilityDetail(person.id, date),
                }).catch((error: unknown) =>
                    fastify.log.error({ err: error, personId: person.id, date }, "Failed to refund credits")
                );
            }
        },
        (error: unknown) => fastify.log.error({ err: error, personId: person.id, date }, "Generation crashed")
    );
}
