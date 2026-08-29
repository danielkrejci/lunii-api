import rateLimit from "@fastify/rate-limit";
import { fromNodeHeaders } from "better-auth/node";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { FastifyInstance, FastifyPluginAsync } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { aiGenerations, dailyInsights, moonInsights, profile as profileTable } from "../../db/schema";
import { auth } from "../../lib/auth";
import { MOON_PHASES, TransitChart } from "../../modules/astro";
import { summarizePlanetInfluence, toContactSummary } from "../../modules/dailyScore";
import { getOrCreateTransits, scoreProfileForDate } from "../../modules/dailyScore/service";
import { DailyScoreResult, PlanetContact } from "../../modules/dailyScore/types";
import { generateMoonInsight, MoonTeaser } from "../../modules/moon/ai";
import { describeMoonDay, MOON_VARIANTS, MoonToday } from "../../modules/moon/today";
import { SINGS_MAP } from "../../utils/natalUtils";
import { errorSchema } from "../../utils/zodResponse";

dayjs.extend(utc);

/**
 * How many lunar contacts the screen and the prompt both get. Higher than the default
 * three the horoscope panel uses: there the Moon is one body among ten, here it is the
 * entire subject.
 *
 * One constant for both on purpose — the text is written from these aspects, so showing
 * a different set underneath it would caption the copy with something it never saw.
 */
const LUNAR_CONTACT_LIMIT = 6;

/** Today's transit-Moon → natal contacts, strongest first. */
function lunarContacts(score: DailyScoreResult): PlanetContact[] {
    return (
        summarizePlanetInfluence(score.impacts, LUNAR_CONTACT_LIMIT).find((planet) => planet.name === "moon")
            ?.contacts ?? []
    );
}

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
                    /**
                     * The whole reading, one text. Paragraphs are separated by a blank
                     * line and the client renders them as separate paragraphs.
                     */
                    insight: z.array(z.string()),
                    contacts: z.record(
                        z.string(),
                        z.object({
                            id: z.string(),
                            title: z.string(),
                            /** Absent on rows written before descriptions existed. */
                            description: z.string().optional(),
                        })
                    ),
                    /**
                     * Chips, not prose: what today's Moon is and is not good for. Four
                     * expressions each, 1–3 words. Empty arrays on rows generated before
                     * these existed.
                     */
                    activities: z.object({ supported: z.array(z.string()), avoid: z.array(z.string()) }),
                }),
                error: z.null(),
            }),
        ]),
    }),
});

type ResponseData = z.infer<typeof responseSchema>["data"];

/**
 * Claims the day and, if the claim succeeds, writes the text. Runs detached from the
 * request that started it: the model needs 30–60 seconds and no client should hold a
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
        .update(moonInsights)
        /**
         * Truncated to milliseconds because the claim timestamp has to survive a round
         * trip through a JS `Date`, which has no microseconds. Full `now()` precision
         * would come back short and the write below would match no row at all.
         */
        .set({ status: "pending", updatedAt: sql`date_trunc('milliseconds', now())` })
        .where(
            and(
                eq(moonInsights.userId, userId),
                eq(moonInsights.date, date),
                isNull(moonInsights.content),
                or(
                    eq(moonInsights.status, "absent"),
                    input.allowFailed ? eq(moonInsights.status, "failed") : sql`false`,
                    and(
                        eq(moonInsights.status, "pending"),
                        lt(moonInsights.updatedAt, sql`now() - interval '5 minutes'`)
                    )
                )
            )
        )
        .returning({ updatedAt: moonInsights.updatedAt, variant: moonInsights.variant });

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
            eq(moonInsights.userId, userId),
            eq(moonInsights.date, date),
            eq(moonInsights.updatedAt, claimed.updatedAt)
        );

        const transitData = await getOrCreateTransits(fastify.db, date, input.profile.timezone);

        const moon = describeMoonDay({
            date,
            timezone: input.profile.timezone,
            sunLongitude: transitData.planets.sun.longitude,
            moonLongitude: transitData.planets.moon.longitude,
            moonSign: transitData.planets.moon.sign,
        });

        const contacts = lunarContacts(scoreProfileForDate(input.profile, transitData.planets));

        /**
         * Best-effort continuity with the horoscope the reader may already have seen.
         * The daily insight has its own lifecycle and may be pending, failed or absent —
         * this must never wait for it, so a missing teaser simply drops the block from
         * the prompt.
         */
        const daily = await fastify.db.query.dailyInsights.findFirst({
            columns: { content: true },
            where: and(eq(dailyInsights.userId, userId), eq(dailyInsights.date, date)),
        });

        const teaser: MoonTeaser | null = daily?.content
            ? {
                  ...daily.content.moon,
                  // What the horoscope already proposed for the day as a whole, so the
                  // Moon screen narrows it rather than repeating or contradicting it.
                  opportunities: daily.content.opportunity?.examples,
                  watchOuts: daily.content.watchOut?.examples,
              }
            : null;

        // One retry, because most failures here are a timeout or a rate limit rather
        // than anything a second attempt would hit again.
        for (let attempt = 1; attempt <= 2; attempt++) {
            const { content, usage } = await generateMoonInsight({
                // The stored variant, not today's: it is what this row promised.
                variant: claimed.variant,
                moon,
                contacts,
                teaser,
                languageIso: input.profile.language,
                // The stored row satisfies Reader structurally, so nothing has to be
                // picked apart here and forgotten when a field is added.
                reader: input.profile,
                natalMoonSign: input.profile.moonSign,
            });

            // The audit row is the only place the prompt, the answer and the price
            // survive, and it must never be the reason a finished text is lost.
            await fastify.db
                .insert(aiGenerations)
                .values({
                    userId,
                    type: "moonInsight",
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
                    .update(moonInsights)
                    .set({ content, status: "ready", updatedAt: sql`date_trunc('milliseconds', now())` })
                    .where(owned)
                    .returning({ date: moonInsights.date });

                // Nothing matched: the row moved on while the model was writing. Worth
                // saying out loud — the text was paid for and then thrown away.
                if (written.length === 0) {
                    fastify.log.warn({ userId, date }, "Generated moon insight discarded, the row had moved on");
                }

                return;
            }
        }

        await fastify.db
            .update(moonInsights)
            .set({ status: "failed", updatedAt: sql`date_trunc('milliseconds', now())` })
            .where(owned);
    })().catch((error: unknown) => fastify.log.error({ err: error, userId, date }, "Moon generation crashed"));
}

/**
 * Creates the day's row if it is not there, and returns the deterministic half.
 *
 * The claim in `generate` is an UPDATE, so it can only fire on a row that already exists
 * — which is why both routes run this before claiming. `variant` is written exactly once,
 * here: on conflict nothing changes, so a row created on an earlier read keeps the
 * variant its text was written for even if the reader has since crossed a timezone.
 */
async function ensureRow(
    db: FastifyInstance["db"],
    input: { userId: string; profile: typeof profileTable.$inferSelect; date: string }
): Promise<{ moon: MoonToday; transits: TransitChart }> {
    const { date, userId } = input;

    const transitData = await getOrCreateTransits(db, date, input.profile.timezone);

    const moon = describeMoonDay({
        date,
        timezone: input.profile.timezone,
        sunLongitude: transitData.planets.sun.longitude,
        moonLongitude: transitData.planets.moon.longitude,
        moonSign: transitData.planets.moon.sign,
    });

    await db.insert(moonInsights).values({ userId, date, variant: moon.variant }).onConflictDoNothing();

    // The transits come back with it: scoring the day needs them, and they cost a query.
    return { moon, transits: transitData.planets };
}

async function buildResponse(
    db: FastifyInstance["db"],
    input: { userId: string; profile: typeof profileTable.$inferSelect; date: string }
): Promise<ResponseData> {
    const { date, userId } = input;

    const { moon, transits } = await ensureRow(db, input);

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
        content:
            stored?.status === "ready" && stored.content
                ? {
                      status: "ready" as const,
                      // Rows written before captions and chips existed carry neither.
                      // Empty is the honest answer, and the screen simply falls back to
                      // the numbers rather than the response failing to serialize.
                      data: {
                          ...stored.content,
                          contacts: stored.content.contacts ?? {},
                          activities: stored.content.activities ?? { supported: [], avoid: [] },
                      },
                      error: null,
                  }
                : stored?.status === "failed"
                  ? {
                        status: "failed" as const,
                        data: null,
                        error: { code: "generation_failed", message: "Generating today's Moon reading failed." },
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
                 * text. Opening the screen is the moment the user asks for it, so there
                 * is nothing else to press. Reads after that change nothing — the claim
                 * only fires while the day has no content and no live run, and a failed
                 * one is left for the explicit retry.
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

                request.log.error({ err: error }, "Failed to read moon insight");

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
             * The only endpoint here that spends money on demand, and there is no
             * attempts counter behind it. Three an hour covers a real failure the user
             * wants to retry, and stops a stuck day from being retried into a bill.
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

                // The client may retry a day it has never read, and the claim below can
                // only update a row that is already there.
                await ensureRow(fastify.db, { userId: session.user.id, profile: session.profile, date });

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

                request.log.error({ err: error }, "Failed to generate moon insight");

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
