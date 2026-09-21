import { GenerateContentResponse } from "@google/genai";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { FastifyInstance } from "fastify";

import { aiGenerations, dailyInsights, profile as profileTable } from "../../db/schema";
import { getOrCreateTransits, scoreProfileForDate } from "../dailyScore/service";
import {
    buildDailyInsightRequest,
    DAILY_INSIGHT_MODEL,
    DailyInsightContent,
    readDailyInsightAnswer,
} from "../insights";
import { BatchAdapter, BatchItem, extractText } from "./batchRunner";
import { cohortFromShardKey } from "./cohorts";
import { selectOutstandingForCohort } from "./eligibility";

type Profile = typeof profileTable.$inferSelect;

/** The model every one of these runs against — the same one the app answers with. */
export const BATCH_MODEL = DAILY_INSIGHT_MODEL;

/**
 * How many horoscopes go in one batch.
 *
 * Bounded by bytes, not by count: an inlined batch is one HTTP request, and a horoscope
 * prompt carries the whole day's transits, every aspect and the reader's chart. A few
 * hundred of those is already megabytes.
 *
 * This number is a conservative guess until it is measured. `ai_generations` now records
 * `input_tokens` for every batched generation, so after one real night the average is a
 * query away — multiply by four for bytes and set this against the API's actual limit.
 */
export const BATCH_CHUNK_SIZE = 500;

/**
 * The horoscope, and the only thing written in advance.
 *
 * Everything else — the Moon, the planets, the people — is started by the client when
 * the app opens: free for a subscriber, on demand for everyone else. Pre-generating it
 * would have meant paying for content before knowing anyone would come back for it, and
 * it needed the horoscope to exist first, which made the nightly run a chain.
 *
 * The horoscope is different because it is the preview on the home screen. Having it
 * ready is what makes the paywall an offer rather than a wait, so it is worth writing
 * for anyone who has been around lately.
 */
export const dailyInsightAdapter: BatchAdapter = {
    contentType: "dailyInsight",

    async claim(fastify, targetDate, shardKey) {
        /**
         * One zone, one chunk. The scheduler walks a cohort by calling this repeatedly
         * with a rising chunk number; because claiming marks a row `queued`, each call
         * naturally returns the next slice of readers who are still unwritten.
         */
        const cohort = await cohortFromShardKey(fastify, targetDate, shardKey);

        if (!cohort) {
            return [];
        }

        const profiles = await selectOutstandingForCohort(fastify, {
            targetDate,
            timezones: cohort.timezones,
            limit: BATCH_CHUNK_SIZE,
        });

        const claimed = await claimRows(fastify, profiles, targetDate);

        const items: BatchItem[] = [];

        /**
         * Transits are the same for everyone in a zone, so they are fetched once and
         * kept. Within a cohort that is a single query for the whole chunk.
         */
        const transitsByZone = new Map<string, Awaited<ReturnType<typeof getOrCreateTransits>>>();

        const transitsFor = async (timezone: string | null) => {
            const key = timezone ?? "UTC";
            const cached = transitsByZone.get(key);

            if (cached) {
                return cached;
            }

            const fresh = await getOrCreateTransits(fastify.db, targetDate, timezone);

            transitsByZone.set(key, fresh);

            return fresh;
        };

        for (const profile of profiles) {
            if (!claimed.has(profile.userId)) {
                continue;
            }

            const { planets, aspects } = await transitsFor(profile.timezone);

            const { prompt, config } = buildDailyInsightRequest({
                // Both halves, exactly as the interactive path passes them: dropping the
                // aspects would quietly write every batched horoscope from a poorer prompt.
                transits: { planets, aspects },
                score: scoreProfileForDate(profile, planets),
                reader: profile,
                languageIso: profile.language,
            });

            items.push({
                metadata: { userId: profile.userId, date: targetDate },
                request: {
                    model: BATCH_MODEL,
                    contents: prompt,
                    config: forBatch(config),
                    metadata: { userId: profile.userId, date: targetDate },
                },
            });
        }

        return items;
    },

    async store(fastify, metadata, response) {
        const { userId, date } = metadata;

        const text = extractText(response);
        const read = readDailyInsightAnswer(text, response?.candidates?.[0]?.finishReason);

        /**
         * Logged whether it worked or not, and before the row is touched. The audit table
         * is the only place the price of a generation survives, and a batch that wrote
         * nothing still cost us the tokens it burned getting there.
         */
        await logBatchGeneration(fastify, { userId, text, response, error: read.error });

        if (!read.content) {
            await release(fastify, userId, date);

            return false;
        }

        return writeContent(fastify, userId, date, read.content);
    },

    async releaseAll(fastify, targetDate) {
        await releaseAllRows(fastify, targetDate);
    },
};

/**
 * The interactive config, minus the one thing a batch cannot take.
 *
 * `responseJsonSchema` works on the live endpoint and is what keeps the shape honest
 * there. Inside an inlined batch request it does the opposite: measured over five
 * identical submissions of the same prompt, four came back as the schema's own keys
 * filled with `null` and the fifth had `overview` as a string containing JSON rather
 * than an object. With the field removed, five out of five came back correctly shaped.
 *
 * So the schema is dropped here and the answer is still checked — `readDailyInsightAnswer`
 * validates every response against the same zod schema either way, so a malformed answer
 * is caught and the day is simply left for the reader's own visit to generate.
 */
function forBatch(config: Record<string, unknown>): Record<string, unknown> {
    const batchConfig = { ...config };

    delete batchConfig.responseJsonSchema;

    return batchConfig;
}

/**
 * Batch pricing, half the interactive rate.
 *
 * A second copy of a number that also lives in `modules/insights` — kept here because
 * that one is the interactive price and this is not, and quietly logging batch work at
 * twice its cost would make the one table that answers "what did this cost" wrong.
 */
const BATCH_PRICE_PER_MILLION = { input: 0.15, output: 1.25 };

/** Writes the audit row for one batched generation. Never the reason a write is lost. */
async function logBatchGeneration(
    fastify: FastifyInstance,
    input: {
        userId: string;
        text: string;
        response: GenerateContentResponse | undefined;
        error: string | null;
    }
): Promise<void> {
    const usage = input.response?.usageMetadata;
    const inputTokens = usage?.promptTokenCount ?? 0;
    // Thinking tokens bill at the output rate but sit outside `candidatesTokenCount`.
    const outputTokens = (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0);

    await fastify.db
        .insert(aiGenerations)
        .values({
            userId: input.userId,
            type: "dailyInsight",
            status: input.error ? "error" : "success",
            error: input.error,
            requestId: input.response?.responseId ?? "",
            provider: "google",
            model: DAILY_INSIGHT_MODEL,
            // The prompt is not carried back from a batch, and storing it twice for
            // tens of thousands of rows a night would dwarf everything else in here.
            input: "[batch]",
            output: input.text,
            inputTokens,
            outputTokens,
            total_tokens: usage?.totalTokenCount ?? inputTokens + outputTokens,
            latencyMs: 0,
            cost:
                (inputTokens / 1_000_000) * BATCH_PRICE_PER_MILLION.input +
                (outputTokens / 1_000_000) * BATCH_PRICE_PER_MILLION.output,
        })
        .catch((error: unknown) => fastify.log.error({ err: error }, "[BATCH] Failed to log a generation"));
}

/**
 * Marks rows `queued`, and returns only the ones this run actually took.
 *
 * `queued` rather than `pending` on purpose: the stuck-generation sweeper fails anything
 * left `pending` for five minutes and would reap an hours-long batch in its first
 * minute, and the on-demand claim only takes `absent` or stale `pending`, so a reader
 * opening the app mid-batch cannot start a second, paid-for generation of the same thing.
 */
async function claimRows(fastify: FastifyInstance, profiles: Profile[], targetDate: string): Promise<Set<string>> {
    if (profiles.length === 0) {
        return new Set();
    }

    const claimed = await fastify.db
        .update(dailyInsights)
        .set({ status: "queued", updatedAt: sql`date_trunc('milliseconds', now())` })
        .where(
            and(
                inArray(
                    dailyInsights.userId,
                    profiles.map((profile) => profile.userId)
                ),
                eq(dailyInsights.date, targetDate),
                isNull(dailyInsights.content),
                eq(dailyInsights.status, "absent")
            )
        )
        .returning({ userId: dailyInsights.userId });

    return new Set(claimed.map((row) => row.userId));
}

async function writeContent(
    fastify: FastifyInstance,
    userId: string,
    date: string,
    content: DailyInsightContent
): Promise<boolean> {
    const [stored] = await fastify.db
        .update(dailyInsights)
        .set({ content, status: "ready", updatedAt: sql`date_trunc('milliseconds', now())` })
        .where(and(eq(dailyInsights.userId, userId), eq(dailyInsights.date, date), eq(dailyInsights.status, "queued")))
        .returning({ userId: dailyInsights.userId });

    return stored !== undefined;
}

/** Hands one claim back, so the next pass or the reader's own visit picks it up. */
async function release(fastify: FastifyInstance, userId: string, date: string): Promise<void> {
    await fastify.db
        .update(dailyInsights)
        .set({ status: "absent", updatedAt: sql`date_trunc('milliseconds', now())` })
        .where(and(eq(dailyInsights.userId, userId), eq(dailyInsights.date, date), eq(dailyInsights.status, "queued")));
}

async function releaseAllRows(fastify: FastifyInstance, targetDate: string): Promise<void> {
    await fastify.db
        .update(dailyInsights)
        .set({ status: "absent", updatedAt: sql`date_trunc('milliseconds', now())` })
        .where(and(eq(dailyInsights.date, targetDate), eq(dailyInsights.status, "queued")));
}
