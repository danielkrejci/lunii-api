import { fromNodeHeaders } from "better-auth/node";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import { and, eq } from "drizzle-orm";
import { FastifyPluginAsync } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { compatibilityPeople, dailyInsights } from "../../db/schema";
import { auth } from "../../lib/auth";
import { pickSuggestions } from "../../modules/chat/suggestions";
import { summarizePlanetInfluence } from "../../modules/dailyScore";
import { getDailyScore, getOrCreateTransits, scoreProfileForDate } from "../../modules/dailyScore/service";
import { errorSchema } from "../../utils/zodResponse";

dayjs.extend(utc);

/**
 * What to offer someone who has opened the chat without a question in mind.
 *
 * Deterministic and free: it reads the day the app has already computed and returns
 * which four to show, as i18n keys. No model call — a suggestion is four words, and
 * paying a generation to write four words would cost more than the answer it leads to.
 */

export default (async (fastify) => {
    fastify.withTypeProvider<ZodTypeProvider>().get(
        "/suggestions",
        {
            schema: {
                querystring: z.object({
                    date: z.string().refine((value) => dayjs.utc(value).isValid(), {
                        message: "Invalid date format",
                    }),
                }),
                response: {
                    200: z.object({
                        data: z.object({
                            items: z.array(
                                z.object({
                                    id: z.string(),
                                    /** An i18next key the app already has a translation for. */
                                    key: z.string(),
                                    params: z.record(z.string(), z.string()).optional(),
                                })
                            ),
                        }),
                    }),
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
                const date = dayjs.utc(request.query.date).format("YYYY-MM-DD");
                const userId = session.user.id;

                const scores = await getDailyScore(fastify.db, { userId, profile: session.profile, date });

                const transits = await getOrCreateTransits(fastify.db, date, session.profile.timezone);
                const score = scoreProfileForDate(session.profile, transits.planets);

                const [loudest] = summarizePlanetInfluence(score.impacts).filter((planet) => planet.aspects > 0);

                const written = await fastify.db.query.dailyInsights.findFirst({
                    columns: { status: true },
                    where: and(eq(dailyInsights.userId, userId), eq(dailyInsights.date, date)),
                });

                // The first saved person, so the chip can name someone real rather than
                // offering compatibility in the abstract.
                const [person] = await fastify.db
                    .select({ name: compatibilityPeople.name })
                    .from(compatibilityPeople)
                    .where(eq(compatibilityPeople.userId, userId))
                    .limit(1);

                const items = pickSuggestions({
                    scores: {
                        love: scores.loveScore,
                        career: scores.careerScore,
                        health: scores.healthScore,
                        mood: scores.moodScore,
                        overall: scores.overallScore,
                    },
                    dominantPlanet: loudest?.name ?? null,
                    hasHoroscope: written?.status === "ready",
                    savedPerson: person?.name ?? null,
                });

                return reply.status(200).send({ data: { items } });
            } catch (error: unknown) {
                request.log.error({ err: error }, "Failed to build chat suggestions");

                return reply.status(500).send({
                    error: { code: "error", message: "Internal Server Error" },
                });
            }
        }
    );
}) satisfies FastifyPluginAsync;
