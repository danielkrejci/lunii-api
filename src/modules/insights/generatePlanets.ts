import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { FastifyInstance } from "fastify";

import { aiGenerations, planetInsights, profile as profileTable } from "../../db/schema";
import { PLANETS } from "../astro";
import { creditKeys } from "../credits/keys";
import { refundUnlocks } from "../credits/service";
import { summarizePlanetInfluence } from "../dailyScore";
import { getOrCreateTransits, scoreProfileForDate } from "../dailyScore/service";
import { awaitDailyContent } from "./awaitDailyContent";
import { startDailyInsightGeneration } from "./generateDaily";
import { DailyTeaser, generatePlanetInsights } from "./planets";

/**
 * Writing the planetary panel, as a thing the server does rather than a thing one route
 * does.
 *
 * Two callers need it: the planet screen, and the profile update, which rewrites a day's
 * panel when the chart, the language or the answers it was written from change.
 */

/**
 * Claims the day and, if the claim succeeds, writes the panel. Runs detached from the
 * request that started it: the model needs 20–40 seconds and no client should hold a
 * connection open that long.
 *
 * The claim is a single statement on purpose — a SELECT followed by an UPDATE would let
 * two concurrent requests both start a paid generation. It fires when the day has no
 * content and nothing else owns it: never generated (`absent`), previously failed but
 * only for an explicit retry, or claimed by a run that has since died and left its
 * `pending` older than the timeout.
 */
export async function startPlanetInsightGeneration(
    fastify: FastifyInstance,
    input: {
        userId: string;
        /** The whole stored profile: scoring needs the chart, the prompt needs the rest. */
        profile: typeof profileTable.$inferSelect;
        date: string;
        allowFailed: boolean;
    }
): Promise<void> {
    const { userId, date } = input;

    const [claimed] = await fastify.db
        .update(planetInsights)
        /**
         * Truncated to milliseconds because the claim timestamp has to survive a round
         * trip through a JS `Date`, which has no microseconds. Full `now()` precision
         * would come back short and the write below would match no row at all.
         */
        .set({ status: "pending", updatedAt: sql`date_trunc('milliseconds', now())` })
        .where(
            and(
                eq(planetInsights.userId, userId),
                eq(planetInsights.date, date),
                isNull(planetInsights.content),
                or(
                    eq(planetInsights.status, "absent"),
                    input.allowFailed ? eq(planetInsights.status, "failed") : sql`false`,
                    and(
                        eq(planetInsights.status, "pending"),
                        lt(planetInsights.updatedAt, sql`now() - interval '5 minutes'`)
                    )
                )
            )
        )
        .returning({ updatedAt: planetInsights.updatedAt });

    if (!claimed) {
        return;
    }

    /**
     * The claim is awaited so the caller can answer with the state it just created; the
     * model itself is not. Every write below carries the claimed timestamp: a run whose
     * row has been touched since (a language change, or a timeout and a new claim) must
     * not overwrite what replaced it.
     */
    void (async () => {
        const owned = and(
            eq(planetInsights.userId, userId),
            eq(planetInsights.date, date),
            eq(planetInsights.updatedAt, claimed.updatedAt)
        );

        const transitData = await getOrCreateTransits(fastify.db, date, input.profile.timezone);
        const score = scoreProfileForDate(input.profile, transitData.planets);

        /**
         * Continuity with the horoscope the reader has open, waited for while it is still
         * being written.
         *
         * In practice a planet is only reachable from an unlocked horoscope, so the wait
         * rarely has anything to do — but it costs nothing when the text is already there
         * and it keeps this path honest when the panel is reached any other way.
         * `awaitDailyContent` gives up on a failure or a timeout, so the panel is never
         * held hostage to a horoscope that is not coming.
         */
        const dailyContent = await awaitDailyContent(fastify.db, {
            userId,
            date,
            /**
             * When nothing is writing the horoscope, ask for it. Writing it costs the
             * reader nothing, and the alternative is this panel quoting a day that was
             * never written.
             */
            start: () =>
                startDailyInsightGeneration(fastify, {
                    userId,
                    profile: input.profile,
                    date,
                    allowFailed: true,
                }),
        });

        const teaser: DailyTeaser | null = dailyContent
            ? {
                  overview: dailyContent.overview,
                  deepInsight: dailyContent.deepInsight,
                  opportunity: dailyContent.opportunity,
                  watchOut: dailyContent.watchOut,
              }
            : null;

        // One retry, because most failures here are a timeout or a rate limit rather
        // than anything a second attempt would hit again.
        for (let attempt = 1; attempt <= 2; attempt++) {
            const { content, usage } = await generatePlanetInsights({
                planets: summarizePlanetInfluence(score.impacts),
                transits: transitData.planets,
                // The stored row satisfies Reader structurally, so nothing has to be
                // picked apart here and forgotten when a field is added.
                reader: input.profile,
                teaser,
                languageIso: input.profile.language,
            });

            // The audit row is the only place the prompt, the answer and the price
            // survive, and it must never be the reason a finished panel is lost.
            await fastify.db
                .insert(aiGenerations)
                .values({
                    userId,
                    type: "planetInsight",
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
                    fastify.log.error({ err: error, userId, date }, "Failed to log AI generation")
                );

            if (content) {
                const written = await fastify.db
                    .update(planetInsights)
                    .set({ content, status: "ready", updatedAt: sql`date_trunc('milliseconds', now())` })
                    .where(owned)
                    .returning({ date: planetInsights.date });

                // Nothing matched: the row moved on while the model was writing. Worth
                // saying out loud — the panel was paid for and then thrown away.
                if (written.length === 0) {
                    fastify.log.warn({ userId, date }, "Generated planet panel discarded, the row had moved on");
                }

                return;
            }
        }

        const failed = await fastify.db
            .update(planetInsights)
            .set({ status: "failed", updatedAt: sql`date_trunc('milliseconds', now())` })
            .where(owned)
            .returning({ date: planetInsights.date });

        /**
         * Give the credits back, and revoke the unlocks with them. Every planet, not
         * just the one that started this: the panel is written once for whoever opened
         * it first, and anyone who bought their way in while it was running paid for
         * the same text that never arrived.
         *
         * Guarded on the update having matched, so only the run that owned this row
         * refunds; `refundUnlock` deletes and returns exactly once, so the sweeper
         * racing it gives back nothing.
         */
        if (failed.length > 0) {
            await refundUnlocks(fastify.db, {
                userId,
                feature: "planetInsight",
                resourceKeys: PLANETS.map((name) => creditKeys.planetInsight(name, date)),
            }).catch((error: unknown) => fastify.log.error({ err: error, userId, date }, "Failed to refund credits"));
        }
    })().catch((error: unknown) => fastify.log.error({ err: error, userId, date }, "Planet generation crashed"));
}
