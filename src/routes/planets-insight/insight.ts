import rateLimit from "@fastify/rate-limit";
import { fromNodeHeaders } from "better-auth/node";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { FastifyInstance, FastifyPluginAsync } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { aiGenerations, dailyInsights, planetInsights, profile as profileTable } from "../../db/schema";
import { auth } from "../../lib/auth";
import { PLANETS } from "../../modules/astro";
import { creditKeys } from "../../modules/credits/keys";
import { AccessState, checkAccess, refundUnlock, spendCredits } from "../../modules/credits/service";
import { summarizePlanetInfluence, toContactSummary } from "../../modules/dailyScore";
import { getOrCreateTransits, scoreProfileForDate } from "../../modules/dailyScore/service";
import { GenerationStatus } from "../../modules/insights";
import { DailyTeaser, generatePlanetInsights, PlanetInsightContent } from "../../modules/insights/planets";
import { accessSchema, errorSchema, insufficientCreditsSchema } from "../../utils/zodResponse";

dayjs.extend(utc);

/**
 * Shared by the read and the generate route on purpose: a generate response can go
 * straight into the client's query cache without a refetch.
 *
 * Everything above `content` is deterministic and always complete — it is recomputed from
 * the ephemeris on every read, so the list of bodies is never empty while the text is
 * pending. `content` is the AI-written half and is all-or-nothing, so `status` alone
 * narrows every field inside it. `absent` never reaches the client: the read path claims
 * the generation before it answers.
 */
const responseSchema = z.object({
    data: z.object({
        date: z.string(),
        /** An array, not a map: the order is the answer — strongest planet first. */
        planets: z.array(
            z.object({
                name: z.enum(PLANETS),
                score: z.number(),
                aspects: z.array(
                    z.object({
                        id: z.string(),
                        transit: z.string(),
                        natal: z.string(),
                        aspect: z.string(),
                        orb: z.number(),
                        exactness: z.number(),
                        supportive: z.boolean(),
                    })
                ),
            })
        ),
        access: accessSchema,
        content: z.discriminatedUnion("status", [
            /**
             * Nobody has paid for this day yet. Everything above stays on screen —
             * only the written half costs anything.
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
                            aspects: z.record(
                                z.string(),
                                z.object({
                                    id: z.string(),
                                    title: z.string(),
                                    /** Absent on rows written before descriptions existed. */
                                    description: z.string().optional(),
                                })
                            ),
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
 * Claims the day and, if the claim succeeds, writes the panel. Runs detached from the
 * request that started it: the model needs 20–40 seconds and no client should hold a
 * connection open that long.
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
        .update(planetInsights)
        /**
         * Truncated to milliseconds because the claim timestamp has to survive a round
         * trip through a JS `Date`, which has no microseconds. Full `now()` precision
         * would come back short and the write below would match no row at all.
         */
        .set({ status: "pending", updatedAt: sql`date_trunc('milliseconds', now())` })
        .where(
            and(
                eq(planetInsights.userId, userId),
                eq(planetInsights.date, date),
                isNull(planetInsights.content),
                or(
                    eq(planetInsights.status, "absent"),
                    input.allowFailed ? eq(planetInsights.status, "failed") : sql`false`,
                    and(
                        eq(planetInsights.status, "pending"),
                        lt(planetInsights.updatedAt, sql`now() - interval '5 minutes'`)
                    )
                )
            )
        )
        .returning({ updatedAt: planetInsights.updatedAt });

    if (!claimed) {
        return;
    }

    /**
     * The claim is awaited so the caller can answer with the state it just created; the
     * model itself is not. Every write below carries the claimed timestamp: a run whose
     * row has been touched since (a language change, or a timeout and a new claim) must
     * not overwrite what replaced it.
     */
    void (async () => {
        const owned = and(
            eq(planetInsights.userId, userId),
            eq(planetInsights.date, date),
            eq(planetInsights.updatedAt, claimed.updatedAt)
        );

        const transitData = await getOrCreateTransits(fastify.db, date, input.profile.timezone);
        const score = scoreProfileForDate(input.profile, transitData.planets);

        /**
         * Best-effort continuity with the horoscope the reader has open. The panel renders
         * from the deterministic half immediately, so a planet can be tapped while the
         * horoscope is still generating — this must never wait for it, so a missing
         * horoscope simply drops the block from the prompt.
         */
        const daily = await fastify.db.query.dailyInsights.findFirst({
            columns: { content: true },
            where: and(eq(dailyInsights.userId, userId), eq(dailyInsights.date, date)),
        });

        const teaser: DailyTeaser | null = daily?.content
            ? {
                  overview: daily.content.overview,
                  deepInsight: daily.content.deepInsight,
                  opportunity: daily.content.opportunity,
                  watchOut: daily.content.watchOut,
              }
            : null;

        // One retry, because most failures here are a timeout or a rate limit rather
        // than anything a second attempt would hit again.
        for (let attempt = 1; attempt <= 2; attempt++) {
            const { content, usage } = await generatePlanetInsights({
                planets: summarizePlanetInfluence(score.impacts),
                // The stored row satisfies Reader structurally, so nothing has to be
                // picked apart here and forgotten when a field is added.
                reader: input.profile,
                teaser,
                languageIso: input.profile.language,
            });

            // The audit row is the only place the prompt, the answer and the price
            // survive, and it must never be the reason a finished panel is lost.
            await fastify.db
                .insert(aiGenerations)
                .values({
                    userId,
                    type: "planetInsight",
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
                    .update(planetInsights)
                    .set({ content, status: "ready", updatedAt: sql`date_trunc('milliseconds', now())` })
                    .where(owned)
                    .returning({ date: planetInsights.date });

                // Nothing matched: the row moved on while the model was writing. Worth
                // saying out loud — the panel was paid for and then thrown away.
                if (written.length === 0) {
                    fastify.log.warn({ userId, date }, "Generated planet panel discarded, the row had moved on");
                }

                return;
            }
        }

        const failed = await fastify.db
            .update(planetInsights)
            .set({ status: "failed", updatedAt: sql`date_trunc('milliseconds', now())` })
            .where(owned)
            .returning({ date: planetInsights.date });

        /**
         * Give the credits back, and revoke the unlock with them. Guarded on the update
         * having matched, so only the run that owned this row refunds; `refundUnlock`
         * deletes and returns exactly once, so the sweeper racing it gives back nothing.
         */
        if (failed.length > 0) {
            await refundUnlock(fastify.db, {
                userId,
                feature: "planetInsight",
                resourceKey: creditKeys.planetInsight(date),
            }).catch((error: unknown) => fastify.log.error({ err: error, userId, date }, "Failed to refund credits"));
        }
    })().catch((error: unknown) => fastify.log.error({ err: error, userId, date }, "Planet generation crashed"));
}

/**
 * Creates the day's row if it is not there, and returns the deterministic half.
 *
 * The claim in `generate` is an UPDATE, so it can only fire on a row that already exists
 * — which is why both routes run this before claiming.
 */
async function buildResponse(
    db: FastifyInstance["db"],
    input: { userId: string; profile: typeof profileTable.$inferSelect; date: string; access: AccessState }
): Promise<ResponseData> {
    const { date, userId } = input;

    await db.insert(planetInsights).values({ userId, date }).onConflictDoNothing();

    const transitData = await getOrCreateTransits(db, date, input.profile.timezone);
    const score = scoreProfileForDate(input.profile, transitData.planets);

    const stored = await db.query.planetInsights.findFirst({
        columns: { content: true, status: true },
        where: and(eq(planetInsights.userId, userId), eq(planetInsights.date, date)),
    });

    return {
        date,
        // Already strongest-first out of the scorer, and the array keeps it that way.
        planets: summarizePlanetInfluence(score.impacts).map((weight) => ({
            name: weight.name,
            score: weight.score,
            aspects: weight.contacts.map(toContactSummary),
        })),
        access: input.access,
        content: describeContent(stored, input.access),
    };
}

/**
 * How the written half is reported.
 *
 * One row holds every planet for a day, so one unlock opens the whole panel rather than
 * a planet at a time. Order matters: `locked` is checked before `failed`, because a
 * failed generation was refunded and its unlock revoked, and reporting the stale failure
 * would offer a retry that silently costs money.
 *
 * `absent` is reported as pending — the read claims the generation for anyone entitled
 * to it, so the client never has to know that state exists.
 */
function describeContent(
    stored: { content: PlanetInsightContent | null; status: GenerationStatus } | undefined,
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
            error: { code: "generation_failed", message: "Generating today's planets failed." },
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
            const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });

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
                    date: z.string().refine((val) => dayjs.utc(val).isValid(), { message: "Invalid date format" }),
                }),
                response: { 200: responseSchema, 401: errorSchema, 409: errorSchema, 500: errorSchema },
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
                const date = dayjs.utc(request.query.date).format("YYYY-MM-DD");

                const access = await checkAccess(fastify.db, {
                    userId: session.user.id,
                    feature: "planetInsight",
                    resourceKey: creditKeys.planetInsight(date),
                });

                const data = await buildResponse(fastify.db, {
                    userId: session.user.id,
                    profile: session.profile,
                    date,
                    access,
                });

                /**
                 * The one side effect of this route: the first read of a day starts the
                 * panel. Opening a planet is the moment the user asks for it, so there is
                 * nothing else to press. Reads after that change nothing — the claim only
                 * fires while the day has no content and no live run, and a failed one is
                 * left for the explicit retry.
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

                request.log.error({ err: error }, "Failed to read planet insights");

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
             * The only endpoint here that spends money on demand, and there is no attempts
             * counter behind it. Three an hour covers a real failure the user wants to
             * retry, and stops a stuck day from being retried into a bill.
             */
            config: { rateLimit: { max: 3, timeWindow: "1 hour" } },
            schema: {
                body: z.object({
                    date: z.string().refine((val) => dayjs.utc(val).isValid(), { message: "Invalid date format" }),
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

                // The client may retry a day it has never read, and the claim below can
                // only update a row that is already there. Just the row: this used to
                // build a whole response and throw it away, which cost an ephemeris read
                // and a full scoring pass for one insert.
                await fastify.db.insert(planetInsights).values({ userId: session.user.id, date }).onConflictDoNothing();

                /**
                 * The purchase. This endpoint is both the unlock and the retry, and the
                 * unlock row is what tells them apart: a reader who already owns the day
                 * is charged nothing, so retrying something they paid for is free.
                 */
                const spend = await spendCredits(fastify.db, {
                    userId: session.user.id,
                    feature: "planetInsight",
                    resourceKey: creditKeys.planetInsight(date),
                });

                if (!spend.ok) {
                    return reply.status(402).send({
                        error: {
                            code: "insufficient_credits" as const,
                            message: "Not enough credits to unlock this reading.",
                            silent: true as const,
                            details: {
                                feature: "planetInsight",
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
                        feature: "planetInsight",
                        resourceKey: creditKeys.planetInsight(date),
                    }),
                });

                return reply.status(202).send({ data });
            } catch (error: unknown) {
                const isDev = process.env.NODE_ENV !== "production";

                request.log.error({ err: error }, "Failed to generate planet insights");

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
