import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { FastifyInstance } from "fastify";

import { aiGenerations, moonInsights, profile as profileTable } from "../../db/schema";
import { runInBackground } from "../../lib/backgroundTasks";
import { TransitChart } from "../astro";
import { creditKeys } from "../credits/keys";
import { refundUnlock } from "../credits/service";
import { summarizePlanetInfluence } from "../dailyScore";
import { getOrCreateTransits, scoreProfileForDate } from "../dailyScore/service";
import { DailyScoreResult, PlanetContact } from "../dailyScore/types";
import { awaitDailyContent } from "../insights/awaitDailyContent";
import { startDailyInsightGeneration } from "../insights/generateDaily";
import { generateMoonInsight, MoonTeaser } from "./ai";
import { describeMoonDay, MoonToday } from "./today";

/**
 * Writing the Moon Today text, as a thing the server does rather than a thing one route
 * does.
 *
 * Two callers need it: the Moon screen, and the profile update, which rewrites a day's
 * text when the chart, the language or the answers it was written from change.
 */

/**
 * Today's transit-Moon → natal contacts, strongest first.
 *
 * On the shared limit rather than one of its own: every screen now shows every aspect a
 * body really makes, so there is nothing left for this one to widen.
 */
export function lunarContacts(score: DailyScoreResult): PlanetContact[] {
    return summarizePlanetInfluence(score.impacts).find((planet) => planet.name === "moon")?.contacts ?? [];
}

/**
 * Claims the day and, if the claim succeeds, writes the text. Runs detached from the
 * request that started it: the model needs 30–60 seconds and no client should hold a
 * connection open that long.
 *
 * The claim is a single statement on purpose — a SELECT followed by an UPDATE would let
 * two concurrent requests both start a paid generation. It fires when the day has no
 * content and nothing else owns it: never generated (`absent`), previously failed but
 * only for an explicit retry, or claimed by a run that has since died and left its
 * `pending` older than the timeout.
 */
export async function startMoonInsightGeneration(
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
        .update(moonInsights)
        /**
         * Truncated to milliseconds because the claim timestamp has to survive a round
         * trip through a JS `Date`, which has no microseconds. Full `now()` precision
         * would come back short and the write below would match no row at all.
         */
        .set({ status: "pending", updatedAt: sql`date_trunc('milliseconds', now())` })
        .where(
            and(
                eq(moonInsights.userId, userId),
                eq(moonInsights.date, date),
                isNull(moonInsights.content),
                or(
                    eq(moonInsights.status, "absent"),
                    input.allowFailed ? eq(moonInsights.status, "failed") : sql`false`,
                    and(
                        eq(moonInsights.status, "pending"),
                        lt(moonInsights.updatedAt, sql`now() - interval '5 minutes'`)
                    )
                )
            )
        )
        .returning({ updatedAt: moonInsights.updatedAt, variant: moonInsights.variant });

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
    runInBackground(
        async () => {
            const owned = and(
                eq(moonInsights.userId, userId),
                eq(moonInsights.date, date),
                eq(moonInsights.updatedAt, claimed.updatedAt)
            );

            const transitData = await getOrCreateTransits(fastify.db, date, input.profile.timezone);

            const moon = describeMoonDay({
                date,
                timezone: input.profile.timezone,
                sunLongitude: transitData.planets.sun.longitude,
                moonLongitude: transitData.planets.moon.longitude,
                moonSign: transitData.planets.moon.sign,
            });

            const contacts = lunarContacts(scoreProfileForDate(input.profile, transitData.planets));

            /**
             * Continuity with the horoscope the reader has open, waited for while it is still
             * being written.
             *
             * The Moon can be opened straight from home, on the same tick the horoscope
             * starts, so without the wait the teaser would be missing exactly when the two
             * texts sit closest together. `awaitDailyContent` waits only on `pending` and
             * gives up on a failure or a timeout, so a broken horoscope still cannot freeze
             * this panel — it just writes standalone.
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

            const teaser: MoonTeaser | null = dailyContent ? dailyContent.moon : null;

            // One retry, because most failures here are a timeout or a rate limit rather
            // than anything a second attempt would hit again.
            for (let attempt = 1; attempt <= 2; attempt++) {
                const { content, usage } = await generateMoonInsight({
                    // The stored variant, not today's: it is what this row promised.
                    variant: claimed.variant,
                    moon,
                    contacts,
                    teaser,
                    languageIso: input.profile.language,
                    // The stored row satisfies Reader structurally, so nothing has to be
                    // picked apart here and forgotten when a field is added.
                    reader: input.profile,
                    natalMoonSign: input.profile.moonSign,
                });

                // The audit row is the only place the prompt, the answer and the price
                // survive, and it must never be the reason a finished text is lost.
                await fastify.db
                    .insert(aiGenerations)
                    .values({
                        userId,
                        type: "moonInsight",
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
                        .update(moonInsights)
                        .set({ content, status: "ready", updatedAt: sql`date_trunc('milliseconds', now())` })
                        .where(owned)
                        .returning({ date: moonInsights.date });

                    // Nothing matched: the row moved on while the model was writing. Worth
                    // saying out loud — the text was paid for and then thrown away.
                    if (written.length === 0) {
                        fastify.log.warn({ userId, date }, "Generated moon insight discarded, the row had moved on");
                    }

                    return;
                }
            }

            const failed = await fastify.db
                .update(moonInsights)
                .set({ status: "failed", updatedAt: sql`date_trunc('milliseconds', now())` })
                .where(owned)
                .returning({ date: moonInsights.date });

            /**
             * Give the credits back, and revoke the unlock with them. Guarded on the update
             * having matched, so only the run that owned this row refunds; `refundUnlock`
             * deletes and returns exactly once, so the sweeper racing it gives back nothing.
             */
            if (failed.length > 0) {
                await refundUnlock(fastify.db, {
                    userId,
                    feature: "moonInsight",
                    resourceKey: creditKeys.moonInsight(date),
                }).catch((error: unknown) =>
                    fastify.log.error({ err: error, userId, date }, "Failed to refund credits")
                );
            }
        },
        (error: unknown) => fastify.log.error({ err: error, userId, date }, "Moon generation crashed")
    );
}

/**
 * Creates the day's row if it is not there, and returns the deterministic half.
 *
 * The claim in `generate` is an UPDATE, so it can only fire on a row that already exists
 * — which is why both routes run this before claiming. `variant` is written exactly once,
 * here: on conflict nothing changes, so a row created on an earlier read keeps the
 * variant its text was written for even if the reader has since crossed a timezone.
 */
export async function ensureMoonRow(
    db: FastifyInstance["db"],
    input: { userId: string; profile: typeof profileTable.$inferSelect; date: string }
): Promise<{ moon: MoonToday; transits: TransitChart }> {
    const { date, userId } = input;

    const transitData = await getOrCreateTransits(db, date, input.profile.timezone);

    const moon = describeMoonDay({
        date,
        timezone: input.profile.timezone,
        sunLongitude: transitData.planets.sun.longitude,
        moonLongitude: transitData.planets.moon.longitude,
        moonSign: transitData.planets.moon.sign,
    });

    await db.insert(moonInsights).values({ userId, date, variant: moon.variant }).onConflictDoNothing();

    // The transits come back with it: scoring the day needs them, and they cost a query.
    return { moon, transits: transitData.planets };
}
