import { GenerateContentResponse, InlinedRequest } from "@google/genai";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { FastifyInstance } from "fastify";

import { generationBatches, generationRuns } from "../../db/schema";
import { ai } from "../../lib/ai";

export type GenerationContentType = "dailyInsight" | "moonInsight" | "planetInsight" | "compatibilityDetail";

/** One thing to write, already claimed and ready to send. */
export interface BatchItem {
    /** Comes back on the response, so results are matched by identity, not by position. */
    metadata: Record<string, string>;
    request: InlinedRequest;
}

/**
 * What one kind of content has to know about itself for the shared runner to write it.
 *
 * Kept this narrow on purpose. Everything the four types have in common — the run row,
 * the unique keys, submitting, polling, cancelling, releasing what was cancelled — lives
 * in the runner; everything that genuinely differs is these three functions.
 */
export interface BatchAdapter {
    contentType: GenerationContentType;
    /**
     * Claims whatever still needs writing for the day and turns it into requests.
     *
     * Claiming is the adapter's job because each type claims its own table, but they all
     * do it the same way: mark the row `queued` so neither the stuck-generation sweeper
     * nor an on-demand read can touch it while Gemini has it.
     */
    claim(fastify: FastifyInstance, targetDate: string, shardKey: string): Promise<BatchItem[]>;
    /**
     * Writes an answer, or hands the claim back if it cannot be used.
     *
     * Takes the whole response rather than just its text: what came back has to be
     * logged with its token counts, and only the adapter knows what kind of generation
     * it was looking at.
     */
    store(
        fastify: FastifyInstance,
        metadata: Record<string, string>,
        response: GenerateContentResponse | undefined
    ): Promise<boolean>;
    /** Hands a claim back untouched — used when a batch is cancelled at the cut-off. */
    releaseAll(fastify: FastifyInstance, targetDate: string): Promise<void>;
}

/**
 * The answer text, read the way a batch actually hands it over.
 *
 * `GenerateContentResponse.text` is an accessor on the SDK's class, and on a live reply
 * it is all you need. A batch result is not a live reply: it is deserialized from the
 * job's output into a **plain object**, so the accessor does not exist on it and reading
 * `.text` gives `undefined` no matter what the model wrote.
 *
 * This was checked once against the SDK sources, found to be a getter, and the fallback
 * below was deleted as dead code. It was not dead — that check only covered the
 * interactive path, and removing it made every batched answer read as empty.
 */
export function extractText(response: GenerateContentResponse | undefined): string {
    if (!response) {
        return "";
    }

    if (typeof response.text === "string" && response.text !== "") {
        return response.text;
    }

    return (response.candidates?.[0]?.content?.parts ?? [])
        .map((part) => part.text ?? "")
        .join("")
        .trim();
}

/**
 * Starts a pass: claims what is outstanding and hands it to Gemini in one batch.
 *
 * The run row goes in first and its unique `(target_date, content_type, pass)` is the
 * guard against paying twice — a second scheduler, a redeploy or a repeated tick
 * conflicts here and stops before a single request is sent.
 */
export async function submitBatch(
    fastify: FastifyInstance,
    input: { adapter: BatchAdapter; targetDate: string; pass: number; shardKey?: string; model: string }
): Promise<{ submitted: number } | null> {
    const { adapter, targetDate, pass } = input;
    const shardKey = input.shardKey ?? "all";

    /**
     * One run per day, shared by every shard of it.
     *
     * The unique key refuses a second insert, which is what stops two schedulers opening
     * the same pass — but a second *shard* is legitimate, so a conflict here means "join
     * the existing run", not "stop".
     */
    const [created] = await fastify.db
        .insert(generationRuns)
        .values({ targetDate, contentType: adapter.contentType, pass })
        .onConflictDoNothing()
        .returning({ id: generationRuns.id });

    const run =
        created ??
        (
            await fastify.db
                .select({ id: generationRuns.id })
                .from(generationRuns)
                .where(
                    and(
                        eq(generationRuns.targetDate, targetDate),
                        eq(generationRuns.contentType, adapter.contentType),
                        eq(generationRuns.pass, pass)
                    )
                )
        )[0];

    if (!run) {
        return null;
    }

    /**
     * The shard is claimed before any work is done, and `(run_id, shard_key)` is what
     * makes that safe: a second tick for the same zone conflicts here and stops before a
     * single request is built, let alone paid for.
     */
    const [batch] = await fastify.db
        .insert(generationBatches)
        .values({ runId: run.id, shardKey, itemCount: 0 })
        .onConflictDoNothing()
        .returning({ id: generationBatches.id });

    if (!batch) {
        return null;
    }

    const items = await adapter.claim(fastify, targetDate, shardKey);

    if (items.length === 0) {
        /**
         * Nothing was left to write, so this shard never existed as work.
         *
         * The row is removed rather than closed: a cohort is walked until a chunk comes
         * back empty, so every cohort would otherwise leave one completed batch of zero
         * items behind, every night, for ever. Deleting is safe because nothing was sent
         * — the Gemini call is below this — and because the next tick finds chunk zero
         * already taken and stops before reaching here again.
         */
        await fastify.db.delete(generationBatches).where(eq(generationBatches.id, batch.id));

        return { submitted: 0 };
    }

    const job = await ai.batches.create({
        model: input.model,
        src: items.map((item) => item.request),
    });

    await fastify.db
        .update(generationBatches)
        .set({ providerBatchId: job.name ?? null, itemCount: items.length })
        .where(eq(generationBatches.id, batch.id));

    fastify.log.info(
        { contentType: adapter.contentType, targetDate, pass, count: items.length, job: job.name },
        "[BATCH] Submitted"
    );

    return { submitted: items.length };
}

/** How long a reserved shard may go without a job id before it is treated as abandoned. */
const ORPHANED_AFTER_MS = 2 * 60 * 60 * 1000;

/** Whether a job is still working. Anything else is finished, one way or another. */
function isRunning(state: string | undefined): boolean {
    return state === "JOB_STATE_RUNNING" || state === "JOB_STATE_PENDING" || state === "JOB_STATE_QUEUED";
}

/**
 * Polls every submitted batch and writes whatever has come back.
 *
 * An answer that is missing or unusable leaves its row unwritten rather than failed:
 * nobody has seen it and nothing was charged for it, so being unwritten is exactly
 * right — it makes the item outstanding again, for the next pass or for the read that
 * happens when the reader opens the app.
 */
export async function collectBatches(fastify: FastifyInstance, adapters: BatchAdapter[]): Promise<void> {
    const byType = new Map(adapters.map((adapter) => [adapter.contentType, adapter]));

    const open = await fastify.db
        .select({ batch: generationBatches, run: generationRuns })
        .from(generationBatches)
        .innerJoin(generationRuns, eq(generationRuns.id, generationBatches.runId))
        .where(eq(generationBatches.status, "submitted"));

    for (const { batch, run } of open) {
        const adapter = byType.get(run.contentType);

        if (!adapter) {
            continue;
        }

        /**
         * A row that reserved a shard and never recorded a job is an orphan: the process
         * died between the two, which a deploy at the top of the hour is exactly placed
         * to cause. Left alone it blocks its shard for ever — the unique key refuses the
         * next attempt, and because a cohort is walked from chunk zero, one orphan skips
         * the whole cohort for that day.
         *
         * Deleting frees the shard so the next tick resubmits it. The days it had already
         * claimed stay `queued` and are not touched here, because this cannot tell them
         * apart from another batch's; they come back through the stale-`queued` reclaim
         * or the cut-off, and the reader's own visit covers them in the meantime.
         *
         * Two hours, because a submit builds a prompt per reader and is slow at size —
         * killing a live one would strand its job at the provider, which is worse than
         * waiting.
         */
        if (!batch.providerBatchId) {
            if (batch.submittedAt.getTime() < Date.now() - ORPHANED_AFTER_MS) {
                fastify.log.warn(
                    { batch: batch.id, shardKey: batch.shardKey },
                    "[BATCH] Releasing a shard whose job was never recorded; a provider job may have been paid for and lost"
                );

                await fastify.db.delete(generationBatches).where(eq(generationBatches.id, batch.id));
            }

            continue;
        }

        const job = await ai.batches.get({ name: batch.providerBatchId }).catch((error: unknown) => {
            fastify.log.error({ err: error, batch: batch.id }, "[BATCH] Could not read job");

            return null;
        });

        if (!job || isRunning(job.state)) {
            continue;
        }

        let written = 0;

        for (const item of job.dest?.inlinedResponses ?? []) {
            if (!item.metadata) {
                continue;
            }

            const stored = await adapter.store(fastify, item.metadata, item.response).catch((error: unknown) => {
                fastify.log.error({ err: error, batch: batch.id }, "[BATCH] Could not store an answer");

                return false;
            });

            if (stored) {
                written++;
            }
        }

        await fastify.db
            .update(generationBatches)
            .set({
                status: job.state === "JOB_STATE_SUCCEEDED" ? "completed" : "failed",
                completedAt: sql`now()`,
            })
            .where(eq(generationBatches.id, batch.id));

        /**
         * The run is finished only once every one of its batches is.
         *
         * A run holds one batch today, but it will hold one per time zone as soon as the
         * work is split — and closing the run on the first arrival would declare a day
         * written while most of it was still in flight.
         */
        const [outstanding] = await fastify.db
            .select({ total: count() })
            .from(generationBatches)
            .where(and(eq(generationBatches.runId, run.id), eq(generationBatches.status, "submitted")));

        if ((outstanding?.total ?? 0) === 0) {
            await fastify.db
                .update(generationRuns)
                .set({ status: "completed", completedAt: sql`now()` })
                .where(eq(generationRuns.id, run.id));
        }

        fastify.log.info(
            { contentType: run.contentType, batch: batch.id, state: job.state, written },
            "[BATCH] Collected"
        );
    }
}

/**
 * The cut-off, a few hours before the day it was writing for.
 *
 * Any batch still running is cancelled rather than waited on. What the cancel releases
 * is simply unwritten again, which is the fallback working as designed rather than a
 * failure: whoever opens the app gets their content written then, in half a minute.
 */
export async function closeRuns(
    fastify: FastifyInstance,
    input: { adapters: BatchAdapter[]; targetDate: string }
): Promise<void> {
    const runs = await fastify.db
        .select({ id: generationRuns.id })
        .from(generationRuns)
        .where(eq(generationRuns.targetDate, input.targetDate));

    if (runs.length > 0) {
        const open = await fastify.db
            .select()
            .from(generationBatches)
            .where(
                and(
                    inArray(
                        generationBatches.runId,
                        runs.map((run) => run.id)
                    ),
                    eq(generationBatches.status, "submitted")
                )
            );

        for (const batch of open) {
            if (batch.providerBatchId) {
                await ai.batches
                    .cancel({ name: batch.providerBatchId })
                    .catch((error: unknown) =>
                        fastify.log.error({ err: error, batch: batch.id }, "[BATCH] Could not cancel")
                    );
            }

            await fastify.db
                .update(generationBatches)
                .set({ status: "cancelled", completedAt: sql`now()` })
                .where(eq(generationBatches.id, batch.id));
        }

        await fastify.db
            .update(generationRuns)
            .set({ status: "completed", completedAt: sql`now()` })
            .where(
                inArray(
                    generationRuns.id,
                    runs.map((run) => run.id)
                )
            );
    }

    // Whatever the cancelled batches were holding goes back to being unwritten.
    for (const adapter of input.adapters) {
        await adapter.releaseAll(fastify, input.targetDate);
    }
}
