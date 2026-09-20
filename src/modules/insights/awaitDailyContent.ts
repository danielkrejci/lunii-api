import { and, eq } from "drizzle-orm";
import { FastifyInstance } from "fastify";

import { dailyInsights } from "../../db/schema";
import { DailyInsightContent } from "./index";

type Db = FastifyInstance["db"];

/** Long enough for a horoscope that is genuinely mid-flight, short enough to not strand a reader. */
const DEFAULT_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 2_000;

/**
 * The horoscope that the Moon and planet panels write against, waited for — and, when
 * nobody is writing it, asked for.
 *
 * Continuity is the whole point of the teaser: these texts narrow what the horoscope
 * already said rather than repeating or contradicting it, and a reader who opens the
 * Moon straight after the app does would otherwise always miss it — the horoscope starts
 * on the same tick and takes the same half minute.
 *
 * A day that failed, or that nobody ever started, used to end the wait immediately and
 * the panel was written without it. That was wrong: the horoscope is free to generate,
 * so the right answer is to ask for it and then wait for that attempt too.
 *
 * What stays from the earlier design is the refusal to tie the two lifecycles together
 * for ever. The wait is bounded, and one retry is all this asks for — a horoscope that
 * is broken twice over lets the panel through without a teaser rather than holding paid
 * content hostage to it.
 *
 * Polls rather than holds anything open: the pool is small and the model call on the
 * other side of this runs for half a minute, so nothing here may occupy a connection.
 */
export async function awaitDailyContent(
    db: Db,
    input: {
        userId: string;
        date: string;
        timeoutMs?: number;
        /**
         * Starts the horoscope when nothing is writing it. Passed in rather than imported
         * so a panel decides whether to ask, and this stays a waiting function.
         */
        start?: () => Promise<void>;
    }
): Promise<DailyInsightContent | null> {
    const deadline = Date.now() + (input.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    /** One nudge, so a permanently broken day is not asked for on every poll. */
    let started = false;

    for (;;) {
        const daily = await db.query.dailyInsights.findFirst({
            columns: { content: true, status: true },
            where: and(eq(dailyInsights.userId, input.userId), eq(dailyInsights.date, input.date)),
        });

        if (daily?.content) {
            return daily.content;
        }

        const idle = !daily || daily.status === "failed" || daily.status === "absent";

        if (idle) {
            // Nobody is writing it. Ask once, then keep waiting against the same deadline.
            if (started || !input.start) {
                return null;
            }

            started = true;

            await input.start().catch(() => {});
        }

        if (Date.now() >= deadline) {
            return null;
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
}
