import { fromNodeHeaders } from "better-auth/node";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import { and, eq, isNull } from "drizzle-orm";
import { FastifyInstance, FastifyPluginAsync } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { dailyInsights } from "../../db/schema";
import { auth } from "../../lib/auth";
import { summarizePlanetInfluence } from "../../modules/dailyScore";
import {
    getDailyScore,
    getOrCreateTransits,
    ScoringProfile,
    scoreProfileForDate,
} from "../../modules/dailyScore/service";
import { DailyPlanetInsight, generatePlanetInsights } from "../../modules/insights";

dayjs.extend(utc);

const errorSchema = z.object({
    error: z.object({
        code: z.string(),
        message: z.string(),
    }),
});

/**
 * Identical for the read and the generate route on purpose: the client can drop a
 * generate response straight into the query cache without a refetch.
 */
const responseSchema = z.object({
    data: z.object({
        date: z.string(),
        /** False while `description` and `reason` are still null. */
        generated: z.boolean(),
        planets: z.array(
            z.object({
                name: z.string(),
                score: z.number(),
                description: z.string().nullable(),
                reason: z.string().nullable(),
                /**
                 * Numbers are recomputed on every read — they are a pure function of the
                 * two charts, so storing them would only create a copy that can drift.
                 * The wording is the stored, translated half, and is null until generated.
                 */
                contacts: z.array(
                    z.object({
                        /** "neptune_trine_moon" */
                        id: z.string(),
                        /** "Tranzitní Neptun v trigonu k natálnímu Měsíci" */
                        label: z.string().nullable(),
                        /** "Emocionální tíha" */
                        title: z.string().nullable(),
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
    }),
});

/**
 * Weights are recomputed on every call and the text is read from storage.
 *
 * Scoring is deterministic and costs ~110 aspect checks, so the panel can always
 * render immediately; only the interpretation needs an AI request, and that lives
 * behind the generate route.
 */
async function buildResponse(
    db: FastifyInstance["db"],
    input: { userId: string; profile: ScoringProfile; date: string; stored?: DailyPlanetInsight[] | null }
) {
    const stored =
        input.stored ??
        (
            await db.query.dailyInsights.findFirst({
                columns: { planets: true },
                where: and(eq(dailyInsights.userId, input.userId), eq(dailyInsights.date, input.date)),
            })
        )?.planets;

    const { planets: transits } = await getOrCreateTransits(db, input.date);
    const score = scoreProfileForDate(input.profile, transits);

    const planets = summarizePlanetInfluence(score.impacts).map((weight) => {
        const written = stored?.find((entry) => entry.name === weight.name);

        return {
            name: weight.name,
            score: weight.score,
            description: written?.description ?? null,
            reason: written?.reason ?? null,
            /**
             * Joined by id rather than by position: the wording was written for one
             * day's contacts, and a body whose aspects have moved on since then must
             * show today's numbers with no label at all rather than yesterday's.
             */
            contacts: weight.contacts.map((contact) => {
                const translated = written?.contacts?.find((entry) => entry.id === contact.id);

                return {
                    id: contact.id,
                    label: translated?.label ?? null,
                    title: translated?.title ?? null,
                    transit: contact.transit,
                    natal: contact.natal,
                    aspect: contact.aspect,
                    orb: Math.round(contact.orb * 10) / 10,
                    exactness: Math.round(contact.strength * 100),
                    supportive: contact.value >= 0,
                };
            }),
        };
    });

    return {
        date: input.date,
        generated: Boolean(stored && stored.length > 0),
        planets,
    };
}

export default (async (fastify) => {
    /* ============================================================
       READ — safe to prefetch, retry and refetch
    ============================================================ */

    fastify.withTypeProvider<ZodTypeProvider>().get(
        "/planets",
        {
            schema: {
                querystring: z.object({
                    date: z.string().refine((val) => dayjs.utc(val).isValid(), {
                        message: "Invalid date format",
                    }),
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
                const data = await buildResponse(fastify.db, {
                    userId: session.user.id,
                    profile: session.profile,
                    date: dayjs.utc(request.query.date).format("YYYY-MM-DD"),
                });

                return reply.status(200).send({ data });
            } catch (error: unknown) {
                const isDev = process.env.NODE_ENV !== "production";

                request.log.error({ err: error }, "Failed to read planet influence");

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
        "/planets/generate",
        {
            schema: {
                body: z.object({
                    date: z.string().refine((val) => dayjs.utc(val).isValid(), {
                        message: "Invalid date format",
                    }),
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
                const date = dayjs.utc(request.body.date).format("YYYY-MM-DD");

                const existing = await fastify.db.query.dailyInsights.findFirst({
                    columns: { planets: true },
                    where: and(eq(dailyInsights.userId, session.user.id), eq(dailyInsights.date, date)),
                });

                // Already written: return it rather than paying for a second interpretation
                // and changing text the user may already be reading.
                if (existing?.planets && existing.planets.length > 0) {
                    const data = await buildResponse(fastify.db, {
                        userId: session.user.id,
                        profile: session.profile,
                        date,
                        stored: existing.planets,
                    });

                    return reply.status(200).send({ data });
                }

                // Guarantees the row exists: the day may never have been opened, and
                // daily_insights cannot hold a planets-only row — the scores are NOT NULL.
                await getDailyScore(fastify.db, {
                    userId: session.user.id,
                    profile: session.profile,
                    date,
                });

                const { planets: transits } = await getOrCreateTransits(fastify.db, date);
                const score = scoreProfileForDate(session.profile, transits);

                const { planets } = await generatePlanetInsights({
                    planets: summarizePlanetInfluence(score.impacts),
                    sunSign: session.profile.sunSign,
                    moonSign: session.profile.moonSign,
                    languageIso: session.profile.language,
                });

                /**
                 * Conditional on purpose. Two concurrent generates both get here, and
                 * whichever lands second must not overwrite text the user is already
                 * reading with an equally valid but different wording.
                 */
                const written = await fastify.db
                    .update(dailyInsights)
                    .set({ planets })
                    .where(
                        and(
                            eq(dailyInsights.userId, session.user.id),
                            eq(dailyInsights.date, date),
                            isNull(dailyInsights.planets)
                        )
                    )
                    .returning({ planets: dailyInsights.planets });

                const data = await buildResponse(fastify.db, {
                    userId: session.user.id,
                    profile: session.profile,
                    date,
                    // Lost the race: serve whatever the winner stored.
                    stored: written.at(0)?.planets ?? undefined,
                });

                return reply.status(200).send({ data });
            } catch (error: unknown) {
                const isDev = process.env.NODE_ENV !== "production";

                request.log.error({ err: error }, "Failed to generate planet interpretations");

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
