import rateLimit from "@fastify/rate-limit";
import { fromNodeHeaders } from "better-auth/node";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import { and, asc, between, eq } from "drizzle-orm";
import { FastifyInstance, FastifyPluginAsync } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { dailyInsights } from "../../db/schema";
import { auth } from "../../lib/auth";
import { touchLastActive } from "../../modules/activity";
import { MOON_PHASES, PLANETS } from "../../modules/astro";
import { creditKeys } from "../../modules/credits/keys";
import { AccessState, checkAccess, spendCredits } from "../../modules/credits/service";
import { summarizePlanetInfluence, toContactSummary } from "../../modules/dailyScore";
import {
    backfillScoresForUser,
    getDailyScore as getOrCreateDailyScore,
    getOrCreateTransits,
    ScoringProfile,
    scoreProfileForDate,
} from "../../modules/dailyScore/service";
import { DailyInsightContent, GenerationStatus } from "../../modules/insights";
import { startDailyInsightGeneration } from "../../modules/insights/generateDaily";
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
             * Written, but not paid for yet. Everything above is still here — the scores,
             * the timeline, the planets — and so is `preview`, because the offer is the
             * horoscope's own opening rather than a description of it.
             *
             * The day is generated before anyone pays, so this state means the text
             * exists and is being held back, never that nothing has been written.
             */
            z.object({
                status: z.literal("locked"),
                data: z.null(),
                preview: z.object({ overview: z.object({ title: z.string(), description: z.string() }) }),
                error: z.null(),
            }),
            z.object({ status: z.literal("pending"), data: z.null(), preview: z.null(), error: z.null() }),
            z.object({
                status: z.literal("failed"),
                data: z.null(),
                preview: z.null(),
                error: z.object({ code: z.string(), message: z.string() }),
            }),
            z.object({
                status: z.literal("ready"),
                preview: z.null(),
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
 * Writing and paying are two separate things now: the day is generated for everyone who
 * opens the app, and credits buy the reveal of a text that already exists. So the wallet
 * is consulted only once there is something to withhold — a day nobody has written yet
 * is `pending` for payer and non-payer alike.
 *
 * `locked` therefore always carries a preview. It can never mean "nothing has been
 * written", which is why the old ordering against `failed` is gone: a failed day is
 * reported as failed, and retrying it costs nothing.
 *
 * `absent` never reaches the client. The read claims the generation for everyone, so the
 * state where a day exists but nothing is happening to it does not need a name out here.
 */
function describeContent(
    stored: { content: DailyInsightContent | null; status: GenerationStatus } | undefined,
    access: AccessState
): ResponseData["content"] {
    if (stored?.status === "ready" && stored.content) {
        if (access.unlocked) {
            return { status: "ready", data: stored.content, preview: null, error: null };
        }

        // The opening of the horoscope itself, rather than a description of it.
        return {
            status: "locked",
            data: null,
            preview: { overview: stored.content.overview },
            error: null,
        };
    }

    if (stored?.status === "failed") {
        return {
            status: "failed",
            data: null,
            preview: null,
            error: { code: "generation_failed", message: "Generating today's reading failed." },
        };
    }

    return { status: "pending", data: null, preview: null, error: null };
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

                /**
                 * The app opening, as far as anything on the server can see it: this read
                 * is what the signed-in layout fires on every launch, whichever tab the
                 * reader lands on. Throttled to an hour inside, so the five-second poll on
                 * a pending day does not write anything.
                 */
                void touchLastActive(fastify.db, session.user.id);

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
                 * horoscope, for everyone. Writing it costs us tokens but costs the reader
                 * nothing — credits buy the reveal, not the generation — so there is no
                 * wallet to consult here and no reason to make a reader wait for a text
                 * they have not decided to buy yet.
                 *
                 * Reads after that change nothing — the claim only fires while the day
                 * has no content and no live run, and a failed one is left for the retry.
                 *
                 * It runs after the response is built because that is what guarantees the
                 * row exists; a day with no content is reported as `pending` either way,
                 * so the answer is already the one this claim is about to make true.
                 */
                if (!data.content.data && data.content.status !== "locked") {
                    await startDailyInsightGeneration(fastify, {
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
       GENERATE — a retry. Costs us an AI request, the reader nothing.
    ============================================================ */

    fastify.withTypeProvider<ZodTypeProvider>().post(
        "/insight/generate",
        {
            /**
             * Free to the reader but not to us, which is why the limit stays. Three an
             * hour covers a real failure someone wants to retry and stops a stuck day
             * from being retried into a bill of our own.
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
                 *
                 * No wallet here any more. Writing the day is ours to pay for; the reader
                 * pays at `/insight/unlock`, and only for a day that already exists.
                 */
                await startDailyInsightGeneration(fastify, {
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

    /* ============================================================
       UNLOCK — the only endpoint that spends credits
    ============================================================ */

    fastify.withTypeProvider<ZodTypeProvider>().post(
        "/insight/unlock",
        {
            /**
             * No rate limit. `spendCredits` is idempotent on `(user, feature, date)`, so a
             * second call is a no-op that charges nothing — and the client fires this the
             * moment a detail screen opens, which a limit would turn into a 429 on an
             * ordinary back-and-forth between two screens.
             */
            schema: {
                body: z.object({
                    date: z.string().refine((val) => dayjs.utc(val).isValid(), {
                        message: "Invalid date format",
                    }),
                }),
                response: {
                    200: responseSchema,
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
                 * The purchase, and nothing else — generation is not this endpoint's
                 * business. The unlock row is the mutual exclusion: opening the same day
                 * twice inserts once, so the second call comes back `already_unlocked`
                 * with a cost of zero and the reader is charged exactly once.
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
                 * Normally the day is already written and this response carries it whole.
                 * When it is not — an unlock that raced the generation — the claim below
                 * makes sure something is working on it rather than leaving the reader
                 * paid up in front of a day nobody is writing.
                 */
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

                if (!data.content.data) {
                    await startDailyInsightGeneration(fastify, {
                        userId: session.user.id,
                        profile: session.profile,
                        date,
                        allowFailed: false,
                    });
                }

                return reply.status(200).send({ data });
            } catch (error: unknown) {
                const isDev = process.env.NODE_ENV !== "production";

                request.log.error({ err: error }, "Failed to unlock daily insight");

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
