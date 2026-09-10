import rateLimit from "@fastify/rate-limit";
import { fromNodeHeaders } from "better-auth/node";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import { and, asc, between, eq, isNull, lt, or, sql } from "drizzle-orm";
import { FastifyInstance, FastifyPluginAsync } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { aiGenerations, dailyInsights, profile as profileTable } from "../../db/schema";
import { auth } from "../../lib/auth";
import { MOON_PHASES, PLANETS } from "../../modules/astro";
import { creditKeys } from "../../modules/credits/keys";
import { AccessState, checkAccess, refundUnlock, spendCredits } from "../../modules/credits/service";
import { summarizePlanetInfluence, toContactSummary } from "../../modules/dailyScore";
import {
    backfillScoresForUser,
    getDailyScore as getOrCreateDailyScore,
    getOrCreateTransits,
    ScoringProfile,
    scoreProfileForDate,
} from "../../modules/dailyScore/service";
import { DailyInsightContent, DailyTransits, generateDailyInsight, GenerationStatus } from "../../modules/insights";
import { elongation, moonIllumination } from "../../modules/moon";
import { getMoonPhase } from "../../modules/transits";
import { serializeDrizzleData } from "../../utils/drizzleUtils";
import { SINGS_MAP } from "../../utils/natalUtils";
import { accessSchema, errorSchema, insufficientCreditsSchema } from "../../utils/zodResponse";

dayjs.extend(utc);

/** The window the timeline covers, and therefore the window that must be scored. */
const TIMELINE_DAYS_BACK = 4;
const TIMELINE_DAYS_FORWARD = 2;

/**
 * Shared by the read and the generate route on purpose: a generate response can go
 * straight into the client's query cache without a refetch.
 *
 * Everything above `content` is deterministic and always complete — it is recomputed
 * from the ephemeris on every read. `content` is the AI-written half and is
 * all-or-nothing, so `status` alone narrows every field inside it. `absent` never
 * reaches the client: the read path claims the generation before it answers.
 */
const responseSchema = z.object({
    data: z.object({
        date: z.string(),
        scores: z.object({
            love: z.number(),
            career: z.number(),
            health: z.number(),
            mood: z.number(),
            overall: z.number(),
        }),
        timeline: z.array(
            z.object({
                date: z.string(),
                isToday: z.boolean(),
                isTomorrow: z.boolean(),
                isYesterday: z.boolean(),
                love: z.number(),
                career: z.number(),
                health: z.number(),
                mood: z.number(),
                overall: z.number(),
            })
        ),
        moon: z.object({
            phase: z.enum(MOON_PHASES),
            illumination: z.number(),
            sign: z.enum(SINGS_MAP),
        }),
        /** An array, not a map: the order is the answer — strongest planet first. */
        planets: z.array(
            z.object({
                name: z.enum(PLANETS),
                score: z.number(),
                aspects: z.array(
                    z.object({
                        /** "neptune_trine_moon" — the join key for the written half. */
                        id: z.string(),
                        transit: z.string(),
                        natal: z.string(),
                        aspect: z.string(),
                        /** Degrees from exact, one decimal. */
                        orb: z.number(),
                        /** 0–100. How precisely the aspect lands today. */
                        exactness: z.number(),
                        /** Supportive or difficult, from the signed contribution. */
                        supportive: z.boolean(),
                    })
                ),
            })
        ),
        access: accessSchema,
        content: z.discriminatedUnion("status", [
            /**
             * Nobody has paid for this day yet. Everything above is still here — the
             * scores, the timeline, the planets — because only the written half costs
             * anything, and a locked screen that still shows the day's numbers is a
             * better argument for unlocking it than an empty one.
             */
            z.object({ status: z.literal("locked"), data: z.null(), error: z.null() }),
            z.object({ status: z.literal("pending"), data: z.null(), error: z.null() }),
            z.object({
                status: z.literal("failed"),
                data: z.null(),
                error: z.object({ code: z.string(), message: z.string() }),
            }),
            z.object({
                status: z.literal("ready"),
                data: z.object({
                    overview: z.object({ title: z.string(), description: z.string() }),
                    /** Paragraphs. Split on the server so no screen has to parse "\n". */
                    deepInsight: z.array(z.string()),
                    /** The day's Moon note, as one text rather than an insight and a reason. */
                    moon: z.object({ insight: z.string() }),
                    opportunity: z.object({ description: z.string(), examples: z.array(z.string()) }),
                    watchOut: z.object({ description: z.string(), examples: z.array(z.string()) }),
                    insights: z.object({
                        love: z.object({ insight: z.string(), reason: z.string() }),
                        career: z.object({ insight: z.string(), reason: z.string() }),
                        health: z.object({ insight: z.string(), reason: z.string() }),
                        mood: z.object({ insight: z.string(), reason: z.string() }),
                        overall: z.object({ insight: z.string(), reason: z.string() }),
                    }),
                }),
                error: z.null(),
            }),
        ]),
    }),
});

type ResponseData = z.infer<typeof responseSchema>["data"];

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
async function generate(
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

async function buildResponse(
    db: FastifyInstance["db"],
    input: { userId: string; profile: ScoringProfile; date: string; access: AccessState }
): Promise<ResponseData> {
    const { date, userId } = input;

    const tomorrow = dayjs.utc(date).add(1, "day").format("YYYY-MM-DD");
    const yesterday = dayjs.utc(date).add(-1, "day").format("YYYY-MM-DD");

    const timelineStartDate = dayjs.utc(date).subtract(TIMELINE_DAYS_BACK, "days").format("YYYY-MM-DD");
    const timelineEndDate = dayjs.utc(date).add(TIMELINE_DAYS_FORWARD, "days").format("YYYY-MM-DD");

    /**
     * Scoring is deterministic and idempotent, so it is safe on the read path — and this
     * is the only place that keeps the timeline whole. The sign-in backfill fills a
     * window once, but the window moves every midnight and no new session is created
     * when the app simply opens on a new day.
     */
    await backfillScoresForUser(db, {
        userId,
        profile: input.profile,
        date,
        daysBack: TIMELINE_DAYS_BACK,
        daysForward: TIMELINE_DAYS_FORWARD,
    });

    const scores = await getOrCreateDailyScore(db, { userId, profile: input.profile, date });

    const stored = await db.query.dailyInsights.findFirst({
        columns: { content: true, status: true },
        where: and(eq(dailyInsights.userId, userId), eq(dailyInsights.date, date)),
    });

    const transitData = await getOrCreateTransits(db, date, input.profile.timezone);
    const score = scoreProfileForDate(input.profile, transitData.planets);

    const timeline = await db
        .select({
            date: dailyInsights.date,
            love: dailyInsights.loveScore,
            career: dailyInsights.careerScore,
            health: dailyInsights.healthScore,
            mood: dailyInsights.moodScore,
            overall: dailyInsights.overallScore,
        })
        .from(dailyInsights)
        .where(and(eq(dailyInsights.userId, userId), between(dailyInsights.date, timelineStartDate, timelineEndDate)))
        .orderBy(asc(dailyInsights.date));

    // Only the deterministic half goes through the serializer: it turns numeric-looking
    // strings into numbers, which is right for numeric columns and wrong for free text.
    const deterministic = serializeDrizzleData({
        date,
        scores: {
            love: scores.loveScore,
            career: scores.careerScore,
            health: scores.healthScore,
            mood: scores.moodScore,
            overall: scores.overallScore,
        },
        timeline: timeline.map((item) => ({
            ...item,
            isToday: item.date === date,
            isTomorrow: item.date === tomorrow,
            isYesterday: item.date === yesterday,
        })),
        moon: {
            phase: getMoonPhase(transitData.planets.sun.longitude, transitData.planets.moon.longitude),
            illumination: moonIllumination(
                elongation(transitData.planets.moon.longitude, transitData.planets.sun.longitude)
            ),
            sign: transitData.planets.moon.sign,
        },
        // Already strongest-first out of the scorer, and the array keeps it that way.
        planets: summarizePlanetInfluence(score.impacts).map((weight) => ({
            name: weight.name,
            score: weight.score,
            aspects: weight.contacts.map(toContactSummary),
        })),
    });

    return { ...deterministic, access: input.access, content: describeContent(stored, input.access) };
}

/**
 * How the written half is reported.
 *
 * Order matters. A day already written is `ready` whatever the wallet says — it was
 * paid for once and stays bought. After that, an unowned day is `locked`, and it is
 * checked before `failed` on purpose: a generation that failed was refunded and its
 * unlock revoked, so reporting the stale failure underneath would offer a retry that
 * silently costs money.
 *
 * `absent` never reaches the client. The read claims the generation for anyone entitled
 * to it, so the state where a day exists but nothing is happening to it does not need a
 * name out here.
 */
function describeContent(
    stored: { content: DailyInsightContent | null; status: GenerationStatus } | undefined,
    access: AccessState
): ResponseData["content"] {
    if (stored?.status === "ready" && stored.content) {
        return { status: "ready", data: stored.content, error: null };
    }

    if (!access.unlocked) {
        return { status: "locked", data: null, error: null };
    }

    if (stored?.status === "failed") {
        return {
            status: "failed",
            data: null,
            error: { code: "generation_failed", message: "Generating today's reading failed." },
        };
    }

    return { status: "pending", data: null, error: null };
}

export default (async (fastify) => {
    /**
     * Registered for this plugin but off by default, so only the generate route below
     * carries it — reading a day must stay free.
     */
    await fastify.register(rateLimit, {
        global: false,
        keyGenerator: async (request) => {
            const session = await auth.api.getSession({
                headers: fromNodeHeaders(request.headers),
            });

            return session?.user?.id ?? request.ip;
        },
        errorResponseBuilder: (_request, context) => {
            const totalSeconds = Math.floor((context?.ttl ?? 0) / 1000);

            return {
                statusCode: 429,
                error: {
                    hours: Math.floor(totalSeconds / 3600),
                    minutes: Math.floor((totalSeconds % 3600) / 60),
                    message: "You've reached the limit for now. Please try again later.",
                    silent: true,
                },
            };
        },
    });

    /* ============================================================
       READ — safe to prefetch, retry and refetch
    ============================================================ */

    fastify.withTypeProvider<ZodTypeProvider>().get(
        "/insight",
        {
            schema: {
                querystring: z.object({
                    date: z.string().refine((val) => dayjs.utc(val).isValid(), {
                        message: "Invalid date format",
                    }),
                }),
                response: {
                    200: responseSchema,
                    401: errorSchema,
                    409: errorSchema,
                    500: errorSchema,
                },
            },
        },
        async (request, reply) => {
            const session = await auth.api.getSession({
                headers: fromNodeHeaders(request.headers),
            });

            if (!session) {
                return reply.status(401).send({
                    error: {
                        code: "unauthorized",
                        message: "User must be logged in to access this resource.",
                    },
                });
            }

            if (!session.profile) {
                return reply.status(409).send({
                    error: {
                        code: "profile_required",
                        message: "User must complete onboarding first.",
                    },
                });
            }

            try {
                const date = dayjs.utc(request.query.date).format("YYYY-MM-DD");

                const access = await checkAccess(fastify.db, {
                    userId: session.user.id,
                    feature: "dailyInsight",
                    resourceKey: creditKeys.dailyInsight(date),
                });

                const data = await buildResponse(fastify.db, {
                    userId: session.user.id,
                    profile: session.profile,
                    date,
                    access,
                });

                /**
                 * The one side effect of this route: the first read of a day starts the
                 * horoscope — but only for a reader who has already paid for it, or who
                 * is subscribed. Everyone else is told `locked` and the generation waits
                 * for the unlock, because a read must never spend credits: the client
                 * polls this endpoint every five seconds while a day is pending.
                 *
                 * Reads after that change nothing — the claim only fires while the day
                 * has no content and no live run, and a failed one is left for the retry.
                 *
                 * It runs after the response is built because that is what guarantees the
                 * row exists; a day with no content is reported as `pending` either way,
                 * so the answer is already the one this claim is about to make true.
                 */
                if (access.unlocked && !data.content.data) {
                    await generate(fastify, {
                        userId: session.user.id,
                        profile: session.profile,
                        date,
                        allowFailed: false,
                    });
                }

                return reply.status(200).send({ data });
            } catch (error: unknown) {
                const isDev = process.env.NODE_ENV !== "production";

                request.log.error({ err: error }, "Failed to read daily insight");

                return reply.status(500).send({
                    error: {
                        code: "error",
                        message:
                            isDev && error instanceof Error ? (error.stack ?? error.message) : "Internal Server Error",
                    },
                });
            }
        }
    );

    /* ============================================================
       GENERATE — costs an AI request, so it is explicit
    ============================================================ */

    fastify.withTypeProvider<ZodTypeProvider>().post(
        "/insight/generate",
        {
            /**
             * The only endpoint that spends money on demand, and there is no attempts
             * counter behind it. Three an hour covers a real failure the user wants to
             * retry, and stops a stuck day from being retried into a bill.
             */
            config: { rateLimit: { max: 3, timeWindow: "1 hour" } },
            schema: {
                body: z.object({
                    date: z.string().refine((val) => dayjs.utc(val).isValid(), {
                        message: "Invalid date format",
                    }),
                }),
                response: {
                    202: responseSchema,
                    401: errorSchema,
                    402: insufficientCreditsSchema,
                    409: errorSchema,
                    500: errorSchema,
                },
            },
        },
        async (request, reply) => {
            const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });

            if (!session) {
                return reply.status(401).send({
                    error: { code: "unauthorized", message: "User must be logged in to access this resource." },
                });
            }

            if (!session.profile) {
                return reply.status(409).send({
                    error: { code: "profile_required", message: "User must complete onboarding first." },
                });
            }

            try {
                const date = dayjs.utc(request.body.date).format("YYYY-MM-DD");

                /**
                 * The purchase. This endpoint is both the unlock and the retry, and the
                 * unlock row is what tells them apart: a reader who already owns the day
                 * is charged nothing, so retrying a generation they paid for is free.
                 *
                 * A failed generation refunds and revokes, so a retry after that pays
                 * again — but the reader was made whole first, and is never left without
                 * both the credits and the horoscope.
                 */
                const spend = await spendCredits(fastify.db, {
                    userId: session.user.id,
                    feature: "dailyInsight",
                    resourceKey: creditKeys.dailyInsight(date),
                });

                if (!spend.ok) {
                    return reply.status(402).send({
                        error: {
                            code: "insufficient_credits" as const,
                            message: "Not enough credits to unlock this reading.",
                            silent: true as const,
                            details: {
                                feature: "dailyInsight",
                                cost: spend.cost,
                                balance: spend.balance,
                                nextCreditAt: spend.nextCreditAt?.toISOString() ?? null,
                            },
                        },
                    });
                }

                /**
                 * Retry after a failure — the one path allowed to claim a `failed` day.
                 * Claimed before the response is built, so the client is told `pending`
                 * and starts polling instead of reading back the failure it just retried.
                 */
                await generate(fastify, {
                    userId: session.user.id,
                    profile: session.profile,
                    date,
                    allowFailed: true,
                });

                const data = await buildResponse(fastify.db, {
                    userId: session.user.id,
                    profile: session.profile,
                    date,
                    access: await checkAccess(fastify.db, {
                        userId: session.user.id,
                        feature: "dailyInsight",
                        resourceKey: creditKeys.dailyInsight(date),
                    }),
                });

                return reply.status(202).send({ data });
            } catch (error: unknown) {
                const isDev = process.env.NODE_ENV !== "production";

                request.log.error({ err: error }, "Failed to generate daily insight");

                return reply.status(500).send({
                    error: {
                        code: "error",
                        message:
                            isDev && error instanceof Error ? (error.stack ?? error.message) : "Internal Server Error",
                    },
                });
            }
        }
    );
}) satisfies FastifyPluginAsync;
