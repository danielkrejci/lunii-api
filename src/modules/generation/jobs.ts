import dayjs from "dayjs";
import { FastifyInstance } from "fastify";
import { AsyncTask, CronJob } from "toad-scheduler";

import { BatchAdapter, closeRuns, collectBatches, submitBatch } from "./batchRunner";
import { groupZonesByOffset, shardKeyFor } from "./cohorts";
import { BATCH_MODEL, dailyInsightAdapter } from "./insightAdapters";

/**
 * How much runway every cohort gets before its own midnight.
 *
 * Gemini's batch turnaround is a target of 24 hours, not a promise. Planning for exactly
 * 24 would mean any batch that overran by a minute arrived after the day had already
 * started for those readers — and nothing would ask for it again. The extra six hours
 * are the same margin the old fixed cut-off had.
 */
const RUNWAY_HOURS = 30;

/**
 * How far ahead the scheduler looks for cohorts to submit.
 *
 * Two days, because the earliest midnight on earth (UTC+14) arrives ten hours before
 * UTC's own, and the deterministic scores are computed that far ahead for exactly this.
 */
const HORIZON_DAYS = 2;

/**
 * The horoscope is the only thing written in advance.
 *
 * The Moon, the planets and the people used to be here too, chained behind the horoscope
 * because they quote it. That chain is gone: a subscriber's client starts them when the
 * app opens, which costs nothing extra for them and spends only on people who actually
 * came back.
 */
const ADAPTERS: BatchAdapter[] = [dailyInsightAdapter];

function targetDate(daysAhead: number): string {
    return dayjs.utc().startOf("day").add(daysAhead, "day").format("YYYY-MM-DD");
}

function cron(fastify: FastifyInstance, name: string, expression: string, run: () => Promise<void>) {
    const task = new AsyncTask(name, run, (err) => {
        fastify.log.error({ err }, `[CRON ERROR] ${name}`);
    });

    return new CronJob({ cronExpression: expression }, task);
}

/**
 * When the given day begins, for readers at this UTC offset.
 *
 * A date is not a moment: midnight on the 20th happens ten hours earlier in Auckland
 * than in London and another eleven before Honolulu. Everything about scheduling this
 * work hangs on that, so it is computed rather than assumed.
 */
function cohortMidnight(date: string, offsetMinutes: number): number {
    return dayjs.utc(date).startOf("day").subtract(offsetMinutes, "minute").valueOf();
}

/**
 * A cohort is never assumed to fit in one batch, and never walked for ever.
 *
 * The ceiling is a guard, not a limit anyone should reach: at the current chunk size it
 * allows a single zone of half a million readers. If it is ever hit, the loop stops
 * quietly and what is left is written on demand — which is far better than a scheduler
 * that spins.
 */
const MAX_CHUNKS_PER_COHORT = 1_000;

/**
 * Submits each time zone when its own deadline comes into view, in batches.
 *
 * Hourly rather than once a night, because there is no single right hour: the cohorts
 * that must go first are the ones furthest east, and an hour that is comfortable for
 * them is a day too early for Hawaii. Asking every hour "whose midnight is now inside
 * the runway" gets each of them the same head start.
 *
 * Each cohort is then walked a chunk at a time. Claiming marks rows `queued`, so asking
 * again returns the next unwritten slice — the loop ends when a chunk comes back empty,
 * which is also what makes the whole thing resumable: a tick that dies halfway leaves
 * the rest outstanding for the next one.
 */
export function createDailyInsightBatchJob(fastify: FastifyInstance) {
    return cron(fastify, "submit-daily-insight-batches", "0 * * * *", async () => {
        const now = Date.now();

        for (let day = 0; day <= HORIZON_DAYS; day++) {
            const date = targetDate(day);
            const byOffset = await groupZonesByOffset(fastify, date);

            for (const offsetMinutes of byOffset.keys()) {
                const hoursLeft = (cohortMidnight(date, offsetMinutes) - now) / 3_600_000;

                // Not yet due, or already past saving — either way not this tick's business.
                if (hoursLeft > RUNWAY_HOURS || hoursLeft <= 0) {
                    continue;
                }

                for (let chunk = 0; chunk < MAX_CHUNKS_PER_COHORT; chunk++) {
                    const result = await submitBatch(fastify, {
                        adapter: dailyInsightAdapter,
                        targetDate: date,
                        pass: 1,
                        shardKey: shardKeyFor(offsetMinutes, chunk),
                        model: BATCH_MODEL,
                    });

                    // Nothing left to write, or this shard was already submitted.
                    if (!result || result.submitted === 0) {
                        break;
                    }
                }
            }
        }
    });
}

/** Picks up whatever Gemini has finished. Cheap when there is nothing open. */
export function createBatchCollectJob(fastify: FastifyInstance) {
    return cron(fastify, "collect-batches", "*/15 * * * *", async () => {
        await collectBatches(fastify, ADAPTERS);
    });
}

/**
 * Closes a day once it has begun everywhere, and releases whatever is still held.
 *
 * Runs hourly but does something only once a day: a date is over as a scheduling problem
 * at 12:00 UTC, because that is midnight at UTC−12, the last zone on earth to enter it.
 * Cancelling before then would pull the work out from under a cohort that had not
 * reached its own midnight yet.
 *
 * Anything still running is cancelled and what it held becomes unwritten again — not a
 * failure but the fallback: those readers get their horoscope written the moment they
 * open the app, interactively, in half a minute. A zone that gets stuck earlier than
 * this does not wait for it either; the on-demand claim takes back a `queued` day that
 * has sat for six hours.
 */
export function createBatchCutoffJob(fastify: FastifyInstance) {
    return cron(fastify, "close-batch-runs", "0 * * * *", async () => {
        const today = targetDate(0);

        if (Date.now() < dayjs.utc(today).startOf("day").add(12, "hour").valueOf()) {
            return;
        }

        await closeRuns(fastify, { adapters: ADAPTERS, targetDate: today });
    });
}
