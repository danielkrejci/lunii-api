import rateLimit from "@fastify/rate-limit";
import { fromNodeHeaders } from "better-auth/node";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import { and, eq } from "drizzle-orm";
import { FastifyInstance, FastifyPluginAsync } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { moonInsights, profile as profileTable } from "../../db/schema";
import { auth } from "../../lib/auth";
import { MOON_PHASES } from "../../modules/astro";
import { creditKeys } from "../../modules/credits/keys";
import { AccessState, checkAccess, spendCredits } from "../../modules/credits/service";
import { toContactSummary } from "../../modules/dailyScore";
import { scoreProfileForDate } from "../../modules/dailyScore/service";
import { GenerationStatus } from "../../modules/insights";
import { MoonInsightContent } from "../../modules/moon/ai";
import { ensureMoonRow, lunarContacts, startMoonInsightGeneration } from "../../modules/moon/generate";
import { MOON_VARIANTS } from "../../modules/moon/today";
import { sendInternalError } from "../../utils/errors";
import { SINGS_MAP } from "../../utils/natalUtils";
import { errorResponseBuilder } from "../../utils/rateLimitResponse";
import { accessSchema, errorSchema, insufficientCreditsSchema } from "../../utils/zodResponse";

dayjs.extend(utc);

/**
 * Shared by the read and the generate route on purpose: a generate response can go
 * straight into the client's query cache without a refetch.
 *
 * Everything above `content` is deterministic and always complete — it is recomputed from
 * the ephemeris on every read, so the screen is never empty while the text is pending.
 * `content` is the AI-written half and is all-or-nothing, so `status` alone narrows every
 * field inside it. `absent` never reaches the client: the read path claims the generation
 * before it answers.
 */
const responseSchema = z.object({
    data: z.object({
        date: z.string(),
        /** Sign the transiting Moon stands in today, not the reader's natal Moon. */
        sign: z.enum(SINGS_MAP),
        phase: z.enum(MOON_PHASES),
        /** 0–100. Share of the disc lit today. */
        illumination: z.number(),
        /**
         * Which layout to show, and which prompt wrote the text. Read from the stored
         * row rather than from today's phase, so the hero can never disagree with the
         * words underneath it.
         */
        variant: z.enum(MOON_VARIANTS),
        /** Local calendar date of the event and whole days until it. Zero means today. */
        nextFullMoon: z.object({ date: z.string(), daysRemaining: z.number() }),
        nextNewMoon: z.object({ date: z.string(), daysRemaining: z.number() }),
        /**
         * The aspects today's Moon makes to the natal chart, strongest first — the same
         * shape the daily horoscope's planetary panel uses, so the app renders both with
         * one component. An empty array is a real answer: some days the Moon is quiet.
         */
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
                    /**
                     * The whole reading, one text. Paragraphs are separated by a blank
                     * line and the client renders them as separate paragraphs.
                     */
                    insight: z.array(z.string()),
                    aspects: z.record(
                        z.string(),
                        z.object({
                            id: z.string(),
                            title: z.string(),
                            /** Absent on rows written before descriptions existed. */
                            description: z.string().optional(),
                        })
                    ),
                }),
                error: z.null(),
            }),
        ]),
    }),
});

type ResponseData = z.infer<typeof responseSchema>["data"];

async function buildResponse(
    db: FastifyInstance["db"],
    input: { userId: string; profile: typeof profileTable.$inferSelect; date: string; access: AccessState }
): Promise<ResponseData> {
    const { date, userId } = input;

    const { moon, transits } = await ensureMoonRow(db, input);

    // Recomputed on every read, exactly like the rest of the deterministic half, and from
    // the same contacts the text was written from.
    const contacts = lunarContacts(scoreProfileForDate(input.profile, transits));

    const stored = await db.query.moonInsights.findFirst({
        columns: { content: true, status: true, variant: true },
        where: and(eq(moonInsights.userId, userId), eq(moonInsights.date, date)),
    });

    return {
        date,
        sign: moon.sign,
        phase: moon.phase,
        illumination: moon.illumination,
        variant: stored?.variant ?? moon.variant,
        nextFullMoon: moon.nextFullMoon,
        nextNewMoon: moon.nextNewMoon,
        aspects: contacts.map((contact) => toContactSummary(contact)),
        // `absent` is reported as pending: the read path claims the generation before it
        // answers, so the client never has to know that state exists.
        access: input.access,
        content: describeContent(stored, input.access),
    };
}

/**
 * How the written half is reported.
 *
 * Order matters. A day already written is `ready` whatever the wallet says — it was
 * paid for once and stays bought. After that an unowned day is `locked`, checked before
 * `failed` because a generation that failed was refunded and its unlock revoked, so
 * reporting the stale failure would offer a retry that silently costs money.
 */
function describeContent(
    stored: { content: MoonInsightContent | null; status: GenerationStatus } | undefined,
    access: AccessState
): ResponseData["content"] {
    if (stored?.status === "ready" && stored.content) {
        return {
            status: "ready",
            // Picked field by field rather than spread: older rows still carry the
            // activity chips that are no longer generated. Rows written before captions
            // existed carry none, and the screen falls back to the numbers.
            data: {
                insight: stored.content.insight,
                aspects: stored.content.contacts ?? {},
            },
            error: null,
        };
    }

    if (!access.unlocked) {
        return { status: "locked", data: null, error: null };
    }

    if (stored?.status === "failed") {
        return {
            status: "failed",
            data: null,
            error: { code: "generation_failed", message: "Generating today's Moon reading failed." },
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
                    feature: "moonInsight",
                    resourceKey: creditKeys.moonInsight(date),
                });

                const data = await buildResponse(fastify.db, {
                    userId: session.user.id,
                    profile: session.profile,
                    date,
                    access,
                });

                /**
                 * The one side effect of this route: the first read of a day starts the
                 * text. Opening the screen is the moment the user asks for it, so there
                 * is nothing else to press. Reads after that change nothing — the claim
                 * only fires while the day has no content and no live run, and a failed
                 * one is left for the explicit retry.
                 *
                 * It runs after the response is built because that is what guarantees the
                 * row exists; a day with no content is reported as `pending` either way,
                 * so the answer is already the one this claim is about to make true.
                 */
                if (access.unlocked && !data.content.data) {
                    await startMoonInsightGeneration(fastify, {
                        userId: session.user.id,
                        profile: session.profile,
                        date,
                        allowFailed: false,
                    });
                }

                return reply.status(200).send({ data });
            } catch (error: unknown) {
                return sendInternalError(request, reply, error, "Failed to read moon insight");
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
             * The only endpoint here that spends money on demand, and there is no
             * attempts counter behind it. Five an hour covers the purchase plus a real
             * failure the user wants to retry, and stops a stuck day from being retried
             * into a bill.
             */
            config: { rateLimit: { max: 5, timeWindow: "1 hour" } },
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

                // The client may retry a day it has never read, and the claim below can
                // only update a row that is already there.
                await ensureMoonRow(fastify.db, { userId: session.user.id, profile: session.profile, date });

                /**
                 * The purchase. This endpoint is both the unlock and the retry, and the
                 * unlock row is what tells them apart: a reader who already owns the day
                 * is charged nothing, so retrying something they paid for is free.
                 */
                const spend = await spendCredits(fastify.db, {
                    userId: session.user.id,
                    feature: "moonInsight",
                    resourceKey: creditKeys.moonInsight(date),
                });

                if (!spend.ok) {
                    return reply.status(402).send({
                        error: {
                            code: "insufficient_credits" as const,
                            message: "Not enough credits to unlock this reading.",
                            silent: true as const,
                            details: {
                                feature: "moonInsight",
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
                await startMoonInsightGeneration(fastify, {
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
                        feature: "moonInsight",
                        resourceKey: creditKeys.moonInsight(date),
                    }),
                });

                return reply.status(202).send({ data });
            } catch (error: unknown) {
                return sendInternalError(request, reply, error, "Failed to generate moon insight");
            }
        }
    );
}) satisfies FastifyPluginAsync;
