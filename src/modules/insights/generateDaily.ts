import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { FastifyInstance } from "fastify";

import { aiGenerations, dailyInsights, profile as profileTable } from "../../db/schema";
import { creditKeys } from "../credits/keys";
import { refundUnlock } from "../credits/service";
import { getOrCreateTransits, scoreProfileForDate } from "../dailyScore/service";
import { DailyTransits, generateDailyInsight } from "./index";

/**
 * Writing the horoscope, as a thing the server does rather than a thing one route does.
 *
 * It lives here because three callers need it: the read that starts a day, the retry,
 * and the Moon and planet panels, which wait for the horoscope they quote and have to be
 * able to ask for it when nothing is writing it. Leaving it in the route would have
 * meant a module importing a route, which is the wrong way round.
 */
/**
 * Claims the day and, if the claim succeeds, writes the horoscope. Runs detached from
 * the request that started it: the model needs 30–60 seconds and no client should hold
 * a connection open that long.
 *
 * The claim is a single statement on purpose — a SELECT followed by an UPDATE would let
 * two concurrent requests both start a paid generation. It fires when the day has no
 * content and nothing else owns it: never generated (`absent`), previously failed but
 * only for an explicit retry, or claimed by a run that has since died and left its
 * `pending` older than the timeout.
 */
export async function startDailyInsightGeneration(
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
        .update(dailyInsights)
        /**
         * Truncated to milliseconds because the claim timestamp has to survive a round
         * trip through a JS `Date`, which has no microseconds. Full `now()` precision
         * would come back short and the write below would match no row at all.
         */
        .set({ status: "pending", updatedAt: sql`date_trunc('milliseconds', now())` })
        .where(
            and(
                eq(dailyInsights.userId, userId),
                eq(dailyInsights.date, date),
                isNull(dailyInsights.content),
                or(
                    eq(dailyInsights.status, "absent"),
                    input.allowFailed ? eq(dailyInsights.status, "failed") : sql`false`,
                    and(
                        eq(dailyInsights.status, "pending"),
                        lt(dailyInsights.updatedAt, sql`now() - interval '5 minutes'`)
                    ),
                    /**
                     * A batch that died without ever coming back leaves its rows `queued`,
                     * and nothing else will free them: the sweeper deliberately skips that
                     * status so it cannot reap a batch mid-flight. The nightly cut-off does
                     * release them, but a reader waiting now should not have to wait for
                     * it. A day claimed for a batch hours ago is a day no batch is coming
                     * for, so this takes it back.
                     */
                    and(
                        eq(dailyInsights.status, "queued"),
                        lt(dailyInsights.updatedAt, sql`now() - interval '6 hours'`)
                    )
                )
            )
        )
        .returning({ updatedAt: dailyInsights.updatedAt });

    if (!claimed) {
        return;
    }

    /**
     * The claim is awaited so the caller can answer with the state it just created; the
     * model itself is not, because it needs 30–60 seconds and no request may hold a
     * connection open that long. Every write below carries the claimed timestamp: a run
     * whose row has been touched since (a language change, or a timeout and a new claim)
     * must not overwrite what replaced it.
     */
    void (async () => {
        const owned = and(
            eq(dailyInsights.userId, userId),
            eq(dailyInsights.date, date),
            eq(dailyInsights.updatedAt, claimed.updatedAt)
        );

        const transitData = await getOrCreateTransits(fastify.db, date, input.profile.timezone);
        const score = scoreProfileForDate(input.profile, transitData.planets);

        // One retry, because most failures here are a timeout or a rate limit rather
        // than anything a second attempt would hit again.
        for (let attempt = 1; attempt <= 2; attempt++) {
            const { content, usage } = await generateDailyInsight({
                transits: {
                    planets: transitData.planets as DailyTransits["planets"],
                    aspects: transitData.aspects as DailyTransits["aspects"],
                },
                score,
                // The stored row satisfies Reader structurally, so nothing has to be
                // picked apart here and forgotten when a field is added.
                reader: input.profile,
                languageIso: input.profile.language,
            });

            // The audit row is the only place the prompt, the answer and the price
            // survive, and it must never be the reason a finished horoscope is lost.
            await fastify.db
                .insert(aiGenerations)
                .values({
                    userId,
                    type: "dailyInsight",
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
                    .update(dailyInsights)
                    .set({ content, status: "ready", updatedAt: sql`date_trunc('milliseconds', now())` })
                    .where(owned)
                    .returning({ date: dailyInsights.date });

                // Nothing matched: the row moved on while the model was writing. Worth
                // saying out loud — the horoscope was paid for and then thrown away.
                if (written.length === 0) {
                    fastify.log.warn({ userId, date }, "Generated insight discarded, the row had moved on");
                }

                return;
            }
        }

        const failed = await fastify.db
            .update(dailyInsights)
            .set({ status: "failed", updatedAt: sql`date_trunc('milliseconds', now())` })
            .where(owned)
            .returning({ date: dailyInsights.date });

        /**
         * Give the credits back, and revoke the unlock with them.
         *
         * Guarded on the update having matched, so only the run that actually owned this
         * row refunds — the sweeper racing the same failure finds nothing to give back,
         * because `refundUnlock` deletes and returns exactly once.
         *
         * Revoking is safe against this run's own late writes: every one of them carries
         * the claimed timestamp, and the update above has already moved it.
         */
        if (failed.length > 0) {
            await refundUnlock(fastify.db, {
                userId,
                feature: "dailyInsight",
                resourceKey: creditKeys.dailyInsight(date),
            }).catch((error: unknown) => fastify.log.error({ err: error, userId, date }, "Failed to refund credits"));
        }
    })().catch((error: unknown) => fastify.log.error({ err: error, userId, date }, "Generation crashed"));
}
