import rateLimit from "@fastify/rate-limit";
import { fromNodeHeaders } from "better-auth/node";
import dayjs from "dayjs";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { FastifyInstance, FastifyPluginAsync } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { aiGenerations, compatibilityPeople, compatibilityPeopleScores } from "../../../db/schema";
import { auth } from "../../../lib/auth";
import { NatalChart } from "../../../modules/astro";
import { generateDailyOverview } from "../../../modules/compatibilityPeople/ai";
import { calculateDailyCompatibility } from "../../../modules/compatibilityPeople/aspects";
import { normalizeScore, OVERALL_NORMALIZER } from "../../../modules/compatibilityPeople/normalizer";
import { INSIGHT_DIRECTIONS, RELATIONSHIP_CATEGORIES } from "../../../modules/compatibilityPeople/types";
import { getOrCreateTransits } from "../../../modules/dailyScore/service";
import { serializeDrizzleData } from "../../../utils/drizzleUtils";
import { Genders, Relationships, SINGS_MAP } from "../../../utils/natalUtils";

const errorSchema = z.object({
    error: z.object({
        code: z.string(),
        message: z.string(),
    }),
});

const overviewBlock = z.object({
    title: z.string(),
    description: z.string(),
    reason: z.string(),
});

/**
 * Shared by the read and the generate route so a generate response can go straight
 * into the client's query cache without a refetch.
 *
 * Everything above `content` is deterministic and always present. `content` is the
 * AI-written half and is all-or-nothing, so `status` alone narrows every field inside
 * it. `absent` never reaches the client: the read claims the generation before it
 * answers.
 */
const responseSchema = z.object({
    data: z.object({
        id: z.string(),
        name: z.string(),
        gender: z.enum(Genders),
        relationship: z.enum(Relationships),
        birthDate: z.string(),
        birthTime: z.string().nullable(),
        birthPlace: z.string().nullable(),
        birthPlaceLat: z.number().nullable(),
        birthPlaceLng: z.number().nullable(),
        sign: z.enum(SINGS_MAP),
        image: z.string().nullable(),
        baseCompatibility: z.any(),
        baseScore: z.number(),
        compatibility: z.any(),
        score: z.number(),
        date: z.string(),
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
                    overview: z.string(),
                    positiveOverview: overviewBlock,
                    negativeOverview: overviewBlock,
                    insights: z.array(
                        z.object({
                            title: z.string(),
                            description: z.string(),
                            reason: z.string(),
                            category: z.enum(RELATIONSHIP_CATEGORIES),
                            direction: z.enum(INSIGHT_DIRECTIONS),
                        })
                    ),
                    practicalAdvice: z.string(),
                }),
                error: z.null(),
            }),
        ]),
    }),
});

function loadPerson(db: FastifyInstance["db"], input: { userId: string; personId: string; date: string }) {
    return (
        db
            .select({
                id: compatibilityPeople.id,
                name: compatibilityPeople.name,
                gender: compatibilityPeople.gender,
                relationship: compatibilityPeople.relationship,
                birthDate: compatibilityPeople.birthDate,
                birthTime: compatibilityPeople.birthTime,
                birthPlace: compatibilityPeople.birthPlace,
                birthPlaceLat: compatibilityPeople.birthPlaceLat,
                birthPlaceLng: compatibilityPeople.birthPlaceLng,
                sign: compatibilityPeople.sunSign,
                image: compatibilityPeople.image,
                birthChart: compatibilityPeople.birthChart,
                baseCompatibility: compatibilityPeople.baseCompatibility,
                baseScore: compatibilityPeople.baseScore,
                score: compatibilityPeopleScores.score,
                compatibility: compatibilityPeopleScores.compatibility,
                content: compatibilityPeopleScores.content,
                status: compatibilityPeopleScores.status,
                date: compatibilityPeopleScores.date,
            })
            .from(compatibilityPeople)
            // Left, not inner: the person must come back even on a day that has no score
            // row yet, so this route can compute one instead of pretending they do not exist.
            .leftJoin(
                compatibilityPeopleScores,
                and(
                    eq(compatibilityPeopleScores.personId, compatibilityPeople.id),
                    eq(compatibilityPeopleScores.date, input.date)
                )
            )
            .where(and(eq(compatibilityPeople.id, input.personId), eq(compatibilityPeople.userId, input.userId)))
            .limit(1)
            .then((rows) => rows.at(0) ?? null)
    );
}

type PersonRow = NonNullable<Awaited<ReturnType<typeof loadPerson>>>;

/** A person whose daily score exists — what both routes work with. */
type Person = PersonRow & { score: number; compatibility: NonNullable<PersonRow["compatibility"]> };

/**
 * The person for a date, computing and storing the daily score when it is missing.
 *
 * Until now only /list created those rows, so a deep link or a prefetched detail
 * arriving first found nothing. The score is a pure function of the transits and both
 * charts, so computing it here costs a few milliseconds and makes the route
 * self-sufficient.
 */
async function loadPersonWithScore(
    db: FastifyInstance["db"],
    input: { userId: string; personId: string; date: string; userChart: NatalChart; timezone: string | null }
): Promise<Person | null> {
    const person = await loadPerson(db, input);

    if (!person) {
        return null;
    }

    if (person.score !== null && person.compatibility !== null) {
        return person as Person;
    }

    const { planets } = await getOrCreateTransits(db, input.date, input.timezone);

    const compatibility = calculateDailyCompatibility(planets, input.userChart, person.birthChart);
    const overallRaw = person.baseCompatibility.overall + compatibility.modifier;

    await db
        .insert(compatibilityPeopleScores)
        .values({
            personId: person.id,
            date: input.date,
            score: normalizeScore(overallRaw, OVERALL_NORMALIZER),
            compatibility,
        })
        // Another request may have inserted the same (personId, date) meanwhile. The
        // value is deterministic, so whichever row won holds what this one computed.
        .onConflictDoNothing();

    const stored = await loadPerson(db, input);

    return stored && stored.score !== null && stored.compatibility !== null ? (stored as Person) : null;
}

function toResponse(person: Person, date: string) {
    return serializeDrizzleData({
        id: person.id,
        name: person.name,
        gender: person.gender,
        relationship: person.relationship,
        birthDate: person.birthDate,
        birthTime: person.birthTime,
        birthPlace: person.birthPlace,
        birthPlaceLat: person.birthPlaceLat,
        birthPlaceLng: person.birthPlaceLng,
        sign: person.sign,
        image: person.image,
        baseCompatibility: person.baseCompatibility,
        baseScore: person.baseScore,
        compatibility: person.compatibility,
        score: person.score,
        date,
        content:
            person.status === "ready" && person.content
                ? { status: "ready" as const, data: person.content, error: null }
                : person.status === "failed"
                  ? {
                        status: "failed" as const,
                        data: null,
                        error: { code: "generation_failed", message: "Writing this reading failed." },
                    }
                  : { status: "pending" as const, data: null, error: null },
    });
}

/**
 * Claims the day for this person and, if the claim succeeds, writes the reading.
 *
 * Same shape as the daily insight: one statement decides who pays for the model, the
 * work itself runs detached, and every write carries the claimed timestamp so a run
 * whose row has moved on cannot overwrite it. The key is (person, date) rather than
 * (user, date) — ownership was already checked by the caller.
 */
async function generate(
    fastify: FastifyInstance,
    input: {
        person: Person;
        profile: NonNullable<NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>["profile"]>;
        date: string;
        allowFailed: boolean;
    }
): Promise<void> {
    const { person, profile, date } = input;

    const [claimed] = await fastify.db
        .update(compatibilityPeopleScores)
        // Milliseconds, because the timestamp has to survive a round trip through a JS
        // `Date`; full `now()` precision would come back short and match no row.
        .set({ status: "pending", updatedAt: sql`date_trunc('milliseconds', now())` })
        .where(
            and(
                eq(compatibilityPeopleScores.personId, person.id),
                eq(compatibilityPeopleScores.date, date),
                isNull(compatibilityPeopleScores.content),
                or(
                    eq(compatibilityPeopleScores.status, "absent"),
                    input.allowFailed ? eq(compatibilityPeopleScores.status, "failed") : sql`false`,
                    and(
                        eq(compatibilityPeopleScores.status, "pending"),
                        lt(compatibilityPeopleScores.updatedAt, sql`now() - interval '5 minutes'`)
                    )
                )
            )
        )
        .returning({ updatedAt: compatibilityPeopleScores.updatedAt });

    if (!claimed) {
        return;
    }

    void (async () => {
        const owned = and(
            eq(compatibilityPeopleScores.personId, person.id),
            eq(compatibilityPeopleScores.date, date),
            eq(compatibilityPeopleScores.updatedAt, claimed.updatedAt)
        );

        // One retry: most failures here are a timeout or a rate limit rather than
        // anything a second attempt would hit again.
        for (let attempt = 1; attempt <= 2; attempt++) {
            const { content, usage } = await generateDailyOverview(profile.language, {
                score: person.score,
                modifier: person.compatibility.modifier,

                positiveTotal: person.compatibility.positiveOverall,
                negativeTotal: person.compatibility.negativeOverall,

                breakdown: person.compatibility.overallBreakdown,

                positiveAspects: person.compatibility.positiveAspects.map(({ rule, score }) => ({
                    title: rule.title,
                    description: rule.description,
                    category: rule.category,
                    planetA: rule.planetA,
                    planetB: rule.planetB,
                    score,
                })),
                negativeAspects: person.compatibility.negativeAspects.map(({ rule, score }) => ({
                    title: rule.title,
                    description: rule.description,
                    category: rule.category,
                    planetA: rule.planetA,
                    planetB: rule.planetB,
                    score,
                })),

                relationshipType: person.relationship,

                personA: { name: profile.name, gender: profile.gender, sunSign: profile.sunSign },
                personB: { name: person.name, gender: person.gender, sunSign: person.sign },
            });

            await fastify.db
                .insert(aiGenerations)
                .values({
                    userId: profile.userId,
                    type: "compatibilityPeople",
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
                    fastify.log.error({ err: error, personId: person.id, date }, "Failed to log AI generation")
                );

            if (content) {
                const written = await fastify.db
                    .update(compatibilityPeopleScores)
                    .set({ content, status: "ready", updatedAt: sql`date_trunc('milliseconds', now())` })
                    .where(owned)
                    .returning({ date: compatibilityPeopleScores.date });

                if (written.length === 0) {
                    fastify.log.warn(
                        { personId: person.id, date },
                        "Generated reading discarded, the row had moved on"
                    );
                }

                return;
            }
        }

        await fastify.db
            .update(compatibilityPeopleScores)
            .set({ status: "failed", updatedAt: sql`date_trunc('milliseconds', now())` })
            .where(owned);
    })().catch((error: unknown) => fastify.log.error({ err: error, personId: person.id, date }, "Generation crashed"));
}

const notFound = {
    error: {
        code: "not_found",
        message: "No such compatibility person.",
    },
};

export default (async (fastify) => {
    /**
     * Registered for this plugin but off by default, so only the generate route carries
     * it — reading a person must stay free. Keyed by person so one noisy relationship
     * cannot lock the others out.
     */
    await fastify.register(rateLimit, {
        global: false,
        keyGenerator: async (request) => {
            const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
            const personId = (request.body as { compatibilityPersonId?: string } | undefined)?.compatibilityPersonId;

            return `${session?.user?.id ?? request.ip}:${personId ?? ""}`;
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
        "/detail",
        {
            schema: {
                querystring: z.object({
                    compatibilityPersonId: z.string().min(1),
                    date: z.string().refine((date) => dayjs(date).isValid(), { message: "Date is invalid" }),
                }),
                response: {
                    200: responseSchema,
                    401: errorSchema,
                    404: errorSchema,
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

                const person = await loadPersonWithScore(fastify.db, {
                    userId: session.user.id,
                    personId: request.query.compatibilityPersonId,
                    date,
                    userChart: session.profile.birthChart,
                    timezone: session.profile.timezone,
                });

                if (!person) {
                    return reply.status(404).send(notFound);
                }

                /**
                 * The one side effect of this route: opening a person's detail starts
                 * their reading. The list never comes here, so nobody pays for a person
                 * whose detail is never opened. Repeated reads change nothing — the claim
                 * only fires while the day has no content and no live run, and a failed
                 * one is left for the explicit retry.
                 */
                if (!person.content) {
                    await generate(fastify, {
                        person,
                        profile: session.profile,
                        date,
                        allowFailed: false,
                    });
                }

                return reply.status(200).send({ data: toResponse(person, date) });
            } catch (error: unknown) {
                const isDev = process.env.NODE_ENV !== "production";

                request.log.error({ err: error }, "Failed to get compatibility person");

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
        "/detail/generate",
        {
            /**
             * The only endpoint here that spends money on demand. Keyed per person, not
             * per user: three an hour covers a real failure worth retrying, and someone
             * with ten people must not exhaust the budget of the other nine.
             */
            config: { rateLimit: { max: 3, timeWindow: "1 hour" } },
            schema: {
                body: z.object({
                    compatibilityPersonId: z.string().min(1),
                    date: z.string().refine((date) => dayjs(date).isValid(), { message: "Date is invalid" }),
                }),
                response: {
                    202: responseSchema,
                    401: errorSchema,
                    404: errorSchema,
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

                const person = await loadPersonWithScore(fastify.db, {
                    userId: session.user.id,
                    personId: request.body.compatibilityPersonId,
                    date,
                    userChart: session.profile.birthChart,
                    timezone: session.profile.timezone,
                });

                if (!person) {
                    return reply.status(404).send(notFound);
                }

                /**
                 * Retry after a failure — the one path allowed to claim a `failed` day.
                 * Claimed before the response is built, so the client is told `pending`
                 * and starts polling instead of reading back the failure it just retried.
                 */
                await generate(fastify, { person, profile: session.profile, date, allowFailed: true });

                const claimed = await loadPersonWithScore(fastify.db, {
                    userId: session.user.id,
                    personId: request.body.compatibilityPersonId,
                    date,
                    userChart: session.profile.birthChart,
                    timezone: session.profile.timezone,
                });

                return reply.status(202).send({ data: toResponse(claimed ?? person, date) });
            } catch (error: unknown) {
                const isDev = process.env.NODE_ENV !== "production";

                request.log.error({ err: error }, "Failed to generate compatibility overview");

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
