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
import { PLANETS } from "../../modules/astro";
import { summarizePlanetInfluence } from "../../modules/dailyScore";
import {
    backfillScoresForUser,
    getDailyScore as getOrCreateDailyScore,
    getOrCreateTransits,
    ScoringProfile,
    scoreProfileForDate,
} from "../../modules/dailyScore/service";
import { DailyTransits, generateDailyInsight } from "../../modules/insights";
import { getMoonPhase } from "../../modules/transits";
import { serializeDrizzleData } from "../../utils/drizzleUtils";
import { errorSchema } from "../../utils/zodResponse";

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
            phase: z.string(),
            /** 0–100. Share of the disc lit today. */
            illumination: z.number(),
        }),
        /** An array, not a map: the order is the answer — strongest planet first. */
        planets: z.array(
            z.object({
                name: z.enum(PLANETS),
                score: z.number(),
                contacts: z.array(
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
        content: z.discriminatedUnion("status", [
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
                    moon: z.object({ insight: z.string(), reason: z.string() }),
                    opportunity: z.object({ description: z.string(), examples: z.array(z.string()) }),
                    watchOut: z.object({ description: z.string(), examples: z.array(z.string()) }),
                    insights: z.object({
                        love: z.object({ insight: z.string(), reason: z.string() }),
                        career: z.object({ insight: z.string(), reason: z.string() }),
                        health: z.object({ insight: z.string(), reason: z.string() }),
                        mood: z.object({ insight: z.string(), reason: z.string() }),
                        overall: z.object({ insight: z.string(), reason: z.string() }),
                    }),
                    planets: z.array(
                        z.object({
                            name: z.enum(PLANETS),
                            description: z.string(),
                            reason: z.string(),
                            /**
                             * Keyed by contact id rather than positional: the wording was
                             * written for one day's aspects, and a contact that has moved
                             * on must simply have no wording.
                             */
                            contacts: z.record(z.string(), z.object({ id: z.string(), title: z.string() })),
                        })
                    ),
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
                planets: summarizePlanetInfluence(score.impacts),
                goals: input.profile.goalsForTheYear,
                languageIso: input.profile.language,
                moonSign: input.profile.moonSign,
                priorities: input.profile.areasOfInterest,
                relationshipStatus: input.profile.relationshipStatus,
                sunSign: input.profile.sunSign,
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

        await fastify.db
            .update(dailyInsights)
            .set({ status: "failed", updatedAt: sql`date_trunc('milliseconds', now())` })
            .where(owned);
    })().catch((error: unknown) => fastify.log.error({ err: error, userId, date }, "Generation crashed"));
}

async function buildResponse(
    db: FastifyInstance["db"],
    input: { userId: string; profile: ScoringProfile; date: string }
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

    // Degrees the Moon stands from the Sun; the cosine of it is the lit share of the disc.
    const elongation = (((transitData.planets.moon.longitude - transitData.planets.sun.longitude) % 360) + 360) % 360;

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
            illumination: Math.round(((1 - Math.cos((elongation * Math.PI) / 180)) / 2) * 100),
        },
        // Already strongest-first out of the scorer, and the array keeps it that way.
        planets: summarizePlanetInfluence(score.impacts).map((weight) => ({
            name: weight.name,
            score: weight.score,
            contacts: weight.contacts.map((contact) => ({
                id: contact.id,
                transit: contact.transit,
                natal: contact.natal,
                aspect: contact.aspect,
                orb: Math.round(contact.orb * 10) / 10,
                exactness: Math.round(contact.strength * 100),
                supportive: contact.value >= 0,
            })),
        })),
    });

    return {
        ...deterministic,
        // `absent` is reported as pending: the read path claims the generation before it
        // answers, so the client never has to know that state exists.
        content:
            stored?.status === "ready" && stored.content
                ? { status: "ready" as const, data: stored.content, error: null }
                : stored?.status === "failed"
                  ? {
                        status: "failed" as const,
                        data: null,
                        error: { code: "generation_failed", message: "Generating today's reading failed." },
                    }
                  : { status: "pending" as const, data: null, error: null },
    };
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

                const data = await buildResponse(fastify.db, {
                    userId: session.user.id,
                    profile: session.profile,
                    date,
                });

                /**
                 * The one side effect of this route: the first read of a day starts the
                 * horoscope. Opening the screen is the moment the user asks for it, so
                 * there is nothing else to press. Reads after that change nothing — the
                 * claim only fires while the day has no content and no live run, and a
                 * failed one is left for the explicit retry.
                 *
                 * It runs after the response is built because that is what guarantees the
                 * row exists; a day with no content is reported as `pending` either way,
                 * so the answer is already the one this claim is about to make true.
                 */
                if (!data.content.data) {
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
