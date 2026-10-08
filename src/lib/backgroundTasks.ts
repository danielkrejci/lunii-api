import { AsyncTask } from "toad-scheduler";

/**
 * Work that outlives the request that started it, kept track of so a deploy can wait
 * for it.
 *
 * App Platform deploys by starting the new instance, moving traffic to it and sending
 * the old one SIGTERM. Without this the old one died mid-generation: the row sat
 * `pending` until the sweeper failed it five minutes later, and the reader watched a
 * spinner for nothing. Now the shutdown waits here before the pool closes.
 */
const running = new Set<Promise<unknown>>();

/**
 * How long shutdown waits for background work. A generation is up to two model calls of
 * 30–60 s, and the Moon and the planets may first wait 90 s for the day's text; the rest
 * is left to the sweeper. Must stay below the termination grace period in App Platform
 * (150 s), which is when the platform stops asking and kills.
 */
export const DRAIN_TIMEOUT_MS = 120_000;

let shuttingDown = false;

/** Called once from the signal handler, before the server starts closing. */
export function beginShutdown(): void {
    shuttingDown = true;
}

export function runningBackgroundTasks(): number {
    return running.size;
}

function track<T>(promise: Promise<T>): Promise<T> {
    running.add(promise);

    const forget = () => running.delete(promise);

    // Both branches, so a rejection is observed here and never surfaces as unhandled.
    promise.then(forget, forget);

    return promise;
}

/**
 * Starts `run` without waiting for it, the way the generation starters always have —
 * and records it, so shutdown can wait for it to finish.
 *
 * Still accepted while shutting down: a request the server already took in may start a
 * generation, and refusing would leave its row `pending` for the sweeper. The drain
 * waits for it instead.
 */
export function runInBackground(run: () => Promise<void>, onError: (error: unknown) => void): void {
    void track(Promise.resolve().then(run).catch(onError));
}

/**
 * A cron task that does not start while the process is shutting down, and that shutdown
 * waits for once it has started — a batch submit killed halfway leaves its shard
 * reserved for two hours.
 */
export function shutdownAwareTask(name: string, run: () => Promise<void>, onError: (error: Error) => void) {
    return new AsyncTask(
        name,
        async () => {
            if (shuttingDown) {
                return;
            }

            await track(run());
        },
        onError
    );
}

/**
 * Waits for everything running, at most `timeoutMs`. Loops because a task may start
 * another — the Moon starts the day's horoscope it is waiting on.
 *
 * Returns how many were still running when the time ran out.
 */
export async function drainBackgroundTasks(timeoutMs: number): Promise<number> {
    const deadline = Date.now() + timeoutMs;

    while (running.size > 0) {
        const left = deadline - Date.now();

        if (left <= 0) {
            break;
        }

        let timer: NodeJS.Timeout | undefined;

        await Promise.race([
            Promise.allSettled(running),
            new Promise<void>((resolve) => {
                timer = setTimeout(resolve, left);
            }),
        ]);

        clearTimeout(timer);
    }

    return running.size;
}
