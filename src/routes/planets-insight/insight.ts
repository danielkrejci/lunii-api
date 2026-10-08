import rateLimit from "@fastify/rate-limit";
import { fromNodeHeaders } from "better-auth/node";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import { and, eq } from "drizzle-orm";
import { FastifyInstance, FastifyPluginAsync } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { planetInsights, profile as profileTable } from "../../db/schema";
import { auth } from "../../lib/auth";
import { Planet, PLANETS } from "../../modules/astro";
import { creditKeys } from "../../modules/credits/keys";
import { AccessState, checkAccess, spendCredits } from "../../modules/credits/service";
import { summarizePlanetInfluence, toContactSummary } from "../../modules/dailyScore";
import { getOrCreateTransits, scoreProfileForDate } from "../../modules/dailyScore/service";
import { GenerationStatus } from "../../modules/insights";
import { startPlanetInsightGeneration } from "../../modules/insights/generatePlanets";
import { PlanetInsightContent } from "../../modules/insights/planets";
import { sendInternalError } from "../../utils/errors";
import { errorResponseBuilder } from "../../utils/rateLimitResponse";
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
                            /** The whole reading, one entry per paragraph. */
                            insight: z.array(z.string()),
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
 * Creates the day's row if it is not there, and returns the deterministic half.
 *
 * The claim in `generate` is an UPDATE, so it can only fire on a row that already exists
 * — which is why both routes run this before claiming.
 */
async function buildResponse(
    db: FastifyInstance["db"],
    input: {
        userId: string;
        profile: typeof profileTable.$inferSelect;
        date: string;
        /** Which planet was asked for. Only its written half is paid for, and returned. */
        planet: Planet;
        access: AccessState;
    }
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
        content: describeContent(stored, input.access, input.planet),
    };
}

/**
 * Rows written before `insight` existed carry a separate `description` and `reason`
 * instead. Read as one text, paragraph by paragraph, so those days stay readable without
 * a migration.
 */
function withInsight(
    item: PlanetInsightContent["planets"][number] & { description?: string; reason?: string }
): PlanetInsightContent["planets"][number] {
    const { description, reason, ...rest } = item;

    if (rest.insight) {
        return rest;
    }

    return {
        ...rest,
        insight: [description, reason]
            .flatMap((text) => text?.split(/\n\s*\n/u) ?? [])
            .map((paragraph) => paragraph.trim())
            .filter(Boolean),
    };
}

/**
 * How the written half is reported, for the one planet that was asked for.
 *
 * One row holds every planet for a day, but an unlock opens a single one of them, so a
 * written panel is still `locked` to a reader who has not paid for this planet — and
 * the text of the others never leaves the server. The filter is the enforcement, not a
 * convenience for the client.
 *
 * Order matters: `locked` comes first now, because a day can be written and unsold at
 * the same time, and it still comes before `failed`, because a failed generation was
 * refunded and its unlocks revoked — reporting the stale failure would offer a retry
 * that silently costs money.
 *
 * `absent` is reported as pending — the read claims the generation for anyone entitled
 * to it, so the client never has to know that state exists.
 */
function describeContent(
    stored: { content: PlanetInsightContent | null; status: GenerationStatus } | undefined,
    access: AccessState,
    planet: Planet
): ResponseData["content"] {
    if (!access.unlocked) {
        return { status: "locked", data: null, error: null };
    }

    if (stored?.status === "ready" && stored.content) {
        return {
            status: "ready",
            data: {
                planets: stored.content.planets.filter((item) => item.name === planet).map(withInsight),
            },
            error: null,
        };
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
        errorResponseBuilder,
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
                    /**
                     * Required, because the answer depends on it: this is one planet's
                     * reading and one planet's price, not the day's.
                     */
                    planet: z.enum(PLANETS),
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
                const planet = request.query.planet;

                const access = await checkAccess(fastify.db, {
                    userId: session.user.id,
                    feature: "planetInsight",
                    resourceKey: creditKeys.planetInsight(planet, date),
                });

                const data = await buildResponse(fastify.db, {
                    userId: session.user.id,
                    profile: session.profile,
                    date,
                    planet,
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
                    await startPlanetInsightGeneration(fastify, {
                        userId: session.user.id,
                        profile: session.profile,
                        date,
                        allowFailed: false,
                    });
                }

                return reply.status(200).send({ data });
            } catch (error: unknown) {
                return sendInternalError(request, reply, error, "Failed to read planet insights");
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
             * counter behind it. It is now the ordinary way a planet is bought rather
             * than only a retry, so the ceiling has to clear ten planets plus a few
             * retries in a day — while still stopping a stuck day from being retried
             * into a bill.
             */
            config: { rateLimit: { max: 20, timeWindow: "1 hour" } },
            schema: {
                body: z.object({
                    date: z.string().refine((val) => dayjs.utc(val).isValid(), { message: "Invalid date format" }),
                    /** Which planet is being bought. The generation is still the day's. */
                    planet: z.enum(PLANETS),
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
                const planet = request.body.planet;

                // The client may retry a day it has never read, and the claim below can
                // only update a row that is already there. Just the row: this used to
                // build a whole response and throw it away, which cost an ephemeris read
                // and a full scoring pass for one insert.
                await fastify.db.insert(planetInsights).values({ userId: session.user.id, date }).onConflictDoNothing();

                /**
                 * The purchase. This endpoint is both the unlock and the retry, and the
                 * unlock row is what tells them apart: a reader who already owns this
                 * planet is charged nothing, so re-opening it, or retrying a generation
                 * they paid for, is free.
                 */
                const spend = await spendCredits(fastify.db, {
                    userId: session.user.id,
                    feature: "planetInsight",
                    resourceKey: creditKeys.planetInsight(planet, date),
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
                 * Starts the day's panel, or retries it — the one path allowed to claim a
                 * `failed` day. Claimed before the response is built, so the client is
                 * told `pending` and starts polling instead of reading back the failure
                 * it just retried.
                 *
                 * A no-op for the second planet bought today: the claim only fires while
                 * the day has no content, so the rest of the panel is already written and
                 * this reader simply gets to see their part of it.
                 */
                await startPlanetInsightGeneration(fastify, {
                    userId: session.user.id,
                    profile: session.profile,
                    date,
                    allowFailed: true,
                });

                const data = await buildResponse(fastify.db, {
                    userId: session.user.id,
                    profile: session.profile,
                    date,
                    planet,
                    access: await checkAccess(fastify.db, {
                        userId: session.user.id,
                        feature: "planetInsight",
                        resourceKey: creditKeys.planetInsight(planet, date),
                    }),
                });

                return reply.status(202).send({ data });
            } catch (error: unknown) {
                return sendInternalError(request, reply, error, "Failed to generate planet insights");
            }
        }
    );
}) satisfies FastifyPluginAsync;
