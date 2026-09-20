import rateLimit from "@fastify/rate-limit";
import { fromNodeHeaders } from "better-auth/node";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone.js";
import utc from "dayjs/plugin/utc.js";
import { FastifyPluginAsync } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { find as geoTz } from "geo-tz";
import { z } from "zod";

import { aiGenerations } from "../../db/schema";
import { ai } from "../../lib/ai";
import { auth } from "../../lib/auth";
import { computeNatalChart, findNatalAspects, NatalAspect, NatalChart } from "../../modules/astro";
import { VOICE_RULES } from "../../modules/insights/voice";
import { buildPromptLanguageRule, getLanguageByIso } from "../../utils/languageUtils";
import { Gender, Genders, SINGS_MAP, ZodiacSign } from "../../utils/natalUtils";
import { humanizeEnum, humanizeEnums, parseLLMJson } from "../../utils/stringUtils";
import { toResponseJsonSchema } from "../../utils/zodResponse";
import { MIN_AGE } from "../profile/add";

dayjs.extend(utc);
dayjs.extend(timezone);

const MODEL = "gemini-2.5-flash";

/** List price per million tokens, so the logged cost is what was actually charged. */
const PRICE_PER_MILLION = { input: 0.3, output: 2.5 };

/**
 * How many standing aspects reach the prompt.
 *
 * Five rather than all of them: a chart makes twenty-odd aspects to itself and a list
 * that long stops being "what defines this person" and becomes an ephemeris dump the
 * model averages out.
 */
const NATAL_ASPECT_LIMIT = 5;

/**
 * The sections, as the model must return them.
 *
 * Keyed to placements rather than to rhetorical jobs, and this is the one route in the app
 * that is allowed to name and explain the astrology: the reader has just arrived, came with
 * the question "what does my sign say about me", and nothing else here answers it.
 *
 * The key ORDER is load-bearing and not cosmetic. The third section is written as a reading
 * of the first two together, which only works if it is written after them; `propertyOrdering`
 * at the call site is what holds the decoder to that. Do not reorder these.
 *
 * Handed to the decoder as a response schema, so an answer that does not fit stops being
 * possible instead of being caught afterwards — this used to fall back to empty strings
 * and store them without anyone noticing.
 */
const answerSchema = z.object({
    /**
     * Every section is paragraphs, following `deepInsight` in modules/insights: the array is
     * the paragraph structure, and a section returned as one entry renders as a wall.
     */
    yourSign: z.array(z.string()),
    yourAscendant: z.array(z.string()),
    inYourLife: z.array(z.string()),
});

/**
 * No birth time, no Ascendant, and therefore no second section — not an empty one.
 *
 * Handing the decoder a schema without the key is what makes the section impossible rather
 * than merely discouraged. `risingSign` is nullable in the database for the same reason an
 * Ascendant without a birth time would be a fabrication, and `profile/add` refuses a second
 * call, so a placeholder written here would be the profile that reader has permanently.
 */
const answerSchemaWithoutAscendant = answerSchema.omit({ yourAscendant: true });

type PersonalityProfile = z.infer<typeof answerSchema>;
type PersonalityProfileWithoutAscendant = z.infer<typeof answerSchemaWithoutAscendant>;

/**
 * Which of the two shapes this reader gets, decided by whether they gave a birth time.
 *
 * One place rather than three: the response schema, the property order and the parse all
 * have to agree, and they drifted apart the moment they were written out separately.
 */
function profileShape(risingSign: string | null) {
    if (risingSign) {
        return {
            schema: answerSchema,
            ordering: ["yourSign", "yourAscendant", "inYourLife"],
            empty: { yourSign: [], yourAscendant: [], inYourLife: [] } satisfies PersonalityProfile,
        };
    }

    return {
        schema: answerSchemaWithoutAscendant,
        ordering: ["yourSign", "inYourLife"],
        empty: { yourSign: [], inYourLife: [] } satisfies PersonalityProfileWithoutAscendant,
    };
}

/* ============================================================
   PROMPT
============================================================ */

function describeNatalAspects(aspects: NatalAspect[]): string {
    if (aspects.length === 0) {
        return "This chart makes no close aspect to itself — nothing here pulls against anything else.";
    }

    return aspects
        .slice(0, NATAL_ASPECT_LIMIT)
        .map(
            (aspect) =>
                `- ${aspect.a} ${aspect.aspect} ${aspect.b} (${aspect.group}, ${aspect.orb.toFixed(1)}° from exact)`
        )
        .join("\n");
}

export function buildPrompt(input: {
    chart: NatalChart;
    aspects: NatalAspect[];
    sunSign: string;
    risingSign: string | null;
    relationshipStatus: string;
    careerStage: string;
    decisionStyle: string;
    areasOfInterest: string[];
    contentPreference: string;
    beliefLevel: string;
    language: string;
}): string {
    const { chart } = input;

    const decisionStyle = humanizeEnum(input.decisionStyle);
    const careerStage = humanizeEnum(input.careerStage);
    const relationshipStatus = humanizeEnum(input.relationshipStatus);
    const interests = humanizeEnums(input.areasOfInterest).join(", ");

    /**
     * The Ascendant section, or nothing at all.
     *
     * Without a birth time the Ascendant is an artefact of an assumed noon — a sign picked
     * essentially at random — so this reader gets two sections and is never told why. An
     * apology for a missing section is worse than a profile that simply has two: they have
     * nothing to compare it against, and the missing one cannot be written later anyway.
     */
    const ascendantSection = input.risingSign
        ? `2. yourAscendant — the placement they have never heard of, and the one that explains
   why people's first impression of them is not quite right. Two paragraphs, and it is
   tight: teach the word in the first, spend the second on the thing worth knowing.

   FIRST PARAGRAPH — the word, taught while you describe them. They do not know what an
   Ascendant is, so assume nothing: not that a chart holds more than one placement, not
   that a placement is a thing. Teach it by contrast with what they just read — their Sun
   is the person once they have settled in, their Ascendant is what a room gets in the
   first ten minutes. Earn the word with the one mechanical fact that is about them: it
   moves a whole sign every two hours, which is why it needed the time of day they were
   born and their Sun sign did not. Theirs is ${input.risingSign}, and say what that face
   looks like. Three sentences at the outside, and never one whose subject is astrology or
   a chart. Never the words "houses", "cusp" or "chart ruler".

   SECOND PARAGRAPH — the GAP, which is the only reason this section exists. Their
   Ascendant promises one thing and their Sun is another, and most readers have felt that
   mismatch without ever having a name for it: read as confident while deciding nothing,
   underestimated, told they are "different once you get to know them". Name it. If the two
   genuinely sit well together, say that instead — and say what it costs to be read
   accurately by everyone, every time, with nowhere to hide.

   No fact from their sign-up form belongs in either paragraph, on purpose: the last
   section has them all, and this is the only section whose subject is a thing rather than
   an area of their life. Take the concreteness from situations anyone would recognise —
   walking into a room where they know nobody, the first ten minutes of an interview, a
   first message. Never a claim about something that actually happened to them.

`
        : "";

    return `==================================================
LANGUAGE AND FORM OF ADDRESS
==================================================

${input.language}

This governs every field you return. It is repeated at the end; check it again before you
answer.

You are writing the personal profile a new user reads when they join an astrology app.

It is the first substantial thing they read about themselves, and it decides whether they
believe this app knows them.

==================================================
THEIR CHART
==================================================

Sun: ${input.sunSign}
Moon: ${chart.moon.sign}
Rising: ${input.risingSign ?? "unknown — no birth time was given"}
Mercury: ${chart.mercury.sign}
Venus: ${chart.venus.sign}
Mars: ${chart.mars.sign}
Saturn: ${chart.saturn.sign}

What the chart does to itself — the tensions and supports they carry permanently:

${describeNatalAspects(input.aspects)}

==================================================
THEM
==================================================

Decides by: ${decisionStyle}
Career right now: ${careerStage}
Relationship: ${relationshipStatus}
Cares about: ${interests}

==================================================
HOW TO WRITE THIS
==================================================

Every section is the intersection of the chart and their life, and it needs both in
roughly equal measure.

The CHART supplies the substance: what this person is actually like, how they are built,
what they do under pressure. That comes from the placements above and nowhere else — it
is why two people in the same job with the same decision style get different profiles.

Their LIFE supplies the setting: where that pattern is showing up for them right now.

Lead with the pattern, land it in their life. A section that only names the pattern is a
horoscope. A section that only describes their circumstances is a summary of a sign-up
form, and they filled that in five minutes ago — they will notice.

Two tests, and a section has to pass both:

- Swap in the opposite decision style and career stage, same chart. If the section
  reads the same, their life is missing.
- Swap in a different chart, same life facts. If the section reads the same, the chart is
  missing — and this is the easier mistake to make, because their answers are concrete and
  the chart is not.

NAME THE CHART, NEVER THE FORM

The chart gets named out loud here, and that is the point of this text. "Your Sun is in
Virgo, so you notice the one thing out of place before you notice the room" is right.
"Your Virgo nature gives you an analytical disposition" is wrong — it named the sign twice
and said nothing about the person. The placement is the doorway, never the subject.

Their sign-up answers are the opposite: never named, always used. Not "as someone who
researches everything", not "since you are ${relationshipStatus}". Those are boxes they
ticked five minutes ago, and handing one back is the app reading its own database out
loud — they notice, and it is the fastest way to lose them. Let the answer decide what
you say, then say the thing itself.

ONE ARGUMENT, NOT SEPARATE OPINIONS

Write the sections in the order they are listed and do not go back. Before you begin one,
read what you have already written and answer it. A section that opens a new subject
instead of building on the one above it is the failure this rule exists for: the reader
gets several opinions about themselves rather than one argument, and several opinions
about the same person always come out sounding like the same opinion repeated.

Never say here what you have already said above. You can see what you wrote — check.

==================================================
SECTIONS
==================================================

Each section opens with a placement and then spends itself on the person. The last section
is the reading of all of them together, and it is the one that has to be unmistakably
about this reader rather than about their sign.

1. yourSign — the answer to the question they arrived with. Two paragraphs, and they do
   different jobs.

   FIRST PARAGRAPH — the sign. Their Sun is in ${input.sunSign}. Say what that means in
   plain speech, the way you would to someone who has read a horoscope column and nothing
   else. This paragraph is the same for everyone born under it and it is meant to be: it
   is the ground the next one stands on, and nobody has told them plainly before. Two
   sentences, and then stop — this is not what they are here for.

   SECOND PARAGRAPH — them, and not the sign. Mercury in ${chart.mercury.sign} is where
   their version departs from the common one: the sign says what they want, Mercury says
   how they actually go about getting it, and the two are often not a comfortable fit.
   They decide by ${decisionStyle}, so say what that looks like in an ordinary week — as
   something they do, not a trait they have. Two sentences here as well.

   The test: someone else with the same Sun sign must not be able to read the second
   paragraph and find it equally true of themselves. If they could, you have written the
   horoscope column twice.

${ascendantSection}${input.risingSign ? "3" : "2"}. inYourLife — the long read, and the only section written about them rather than
   about a placement.

   Everything above was one placement at a time. This is what those placements do to each
   other, and what that looks like inside the life they actually described on the way in.

   The standing aspects are the engine here — that is what this chart does to ITSELF, the
   friction or the ease this person carries into every room regardless of what is happening
   that week. That is the material neither section above had.

   What they gave you: they are ${relationshipStatus}, their energy goes into ${interests},
   their career is ${careerStage}. Use those as the rooms this personality is standing in,
   not as subjects to mention. Naming the fact back to them is the fastest way to lose
   them — they filled that form in five minutes ago.

   Several angles, one per paragraph, each one somewhere the others are not: how they are
   with people close to them, how they are when they work, what they are like under
   pressure, what they want that they would not say out loud. Pick the ones this chart
   actually has something to say about and drop the rest. A paragraph that restates the
   one above it in richer words is the failure to watch for.

   This is analysis, not a plan. Say what is true of them. Never say what they should do
   about it, never suggest, never encourage, and never end on a lesson.

Where a concrete example helps, take it from what they care about.

==================================================
OUTPUT
==================================================

Return ONLY valid JSON, with the fields in this order:

{
${
    input.risingSign
        ? `    "yourSign": ["string", "string"],
    "yourAscendant": ["string", "string"],`
        : `    "yourSign": ["string", "string"],`
}
    "inYourLife": ["string", "string", "..."]
}

- yourSign: exactly 2 entries, 2 sentences each.
${input.risingSign ? "- yourAscendant: exactly 2 entries, 3 sentences at the outside in the first and 2 to 3 in the second.\n" : ""}- inYourLife: 3 to 5 entries, 3 to 5 sentences each.

ONE PARAGRAPH PER ARRAY ENTRY, in every field. Never put a line break inside an entry, and
never return a section as a single entry — the array IS the paragraph structure, and one
long entry renders as a wall of text.

The first two sections are short on purpose. They are the way in, not the reading: the
last section is where the room is. A first section that runs long is one that kept
explaining the sign after it had finished.

Count sentences, not characters. Most sentences run well under twenty words and some are
much shorter; the budget exists to leave room for the concrete detail, never to be filled
with longer sentences or a bigger vocabulary. A section that reaches its count by restating
itself is worse than one that stops a sentence early.

Describe patterns and behaviour, never labels or traits.

Nothing about "the universe", "cosmic energy", "the cosmos", or "you are destined".

No markdown and no headings.

==================================================
HOW TO WRITE IT
==================================================

${VOICE_RULES}

A PERSON, NOT A DAY

Take the register from the rules above — plain words, real situations, one idea per
sentence — and throw their tense away. They are written for a horoscope, so every example
in them says "today". There is no today here.

Everything in this profile is true of this person in general: last year, this month, next
spring. Present tense, and permanent.

  Wrong: "today you will want to think it over before you answer"
  Right: "you think things over before you answer, and being rushed is what you resent"

Two things are banned outright, in any language, because they are what turns this back
into a horoscope:

- any word that fixes it to a moment — "today", "this week", "right now", "at the moment",
  "currently", "lately"
- any instruction to go and do something — "try", "start", "ask them", "pick one", "say
  it out loud". You are describing a person, not giving them a task. Nothing here is
  advice, and no sentence ends in a suggestion.

The test: if a sentence would still make sense sent as a message tomorrow morning, it is a
horoscope and does not belong in this profile.

NAME THE ASTROLOGY HERE — THIS IS THE EXCEPTION

The writing rules above forbid naming a planet, a sign, an aspect or the Ascendant, on the
grounds that the reader is not an astrologer. That is right everywhere else in this app and
wrong here. This is the first thing they read after signing up to an astrology app, they
came with the question "what does my sign say about me", and nothing else will answer it.

So: name the signs. Name the planets. Name the Ascendant and explain what it is.

NAME THE PLANETS, NEVER THE ANGLE BETWEEN THEM

Two planets are "pulling against each other", "working together", "putting pressure on"
one another. That is the whole vocabulary you need and it is the honest one.

Never name the aspect itself — not conjunction, not square, not trine, opposition or
sextile, in any language. Two reasons, and the second is the serious one. It is a word the
reader would have to look up. And it is a word you will get wrong: the list above says
which aspect each pair makes, and writing "conjunction" over a square is a factual error
about this person's chart that any reader who knows charts will catch. Say what the two
planets do to each other and you cannot be wrong about it.

Never reach for a vague substitute either — "because of the influences in your chart",
"given the placements involved". Name the two planets or say nothing.

What does NOT come back with the vocabulary:

- Geometry first. Never open on the mechanism and arrive at the person late.

    Bad:  "Venus is in opposition to your natal Saturn and square your Ascendant, which
           creates tension in close relationships."
    Good: "Venus and Saturn pull against each other in your chart. Warmth costs you more
           effort than it costs other people, and you would rather be useful than fond."

  The bad one is twice as long, spends its first sentence on geometry and ends in abstract
  nouns. All three are the failure.

- Jargon with no payoff: degrees, orbs, houses, "cusp", "natal", "retrograde", "chart
  ruler", element and modality names. A word the reader would have to look up is a word
  that has told them nothing.

- One clause of mechanism, then the person. Never two sentences of it in a row.

Everything else above still holds without exception: plain words, one idea per sentence,
concrete rather than abstract, the ordinary name for each body in their language, no
therapy register, no essayist's closing move. Observant and psychologically believable —
someone who has been paying attention, not someone reading a chart aloud.

They describe their belief in astrology as "${humanizeEnum(input.beliefLevel)}" and prefer
content that is "${humanizeEnum(input.contentPreference)}". Match that register. Never
write about it.

Respond only in:
${input.language}`;
}

/* ============================================================
   ROUTE
============================================================ */

/**
 * Deliberately free, and deliberately the only generating route that is.
 *
 * This runs during onboarding, before a profile exists and therefore before anyone has
 * a reason to care about credits. A reader who cannot finish signing up is worth far
 * more than five of them. Its model cost stays unbilled on purpose — please do not
 * "fix" that later.
 */
export default (async (fastify) => {
    await fastify.register(rateLimit, {
        max: 5,
        timeWindow: "1 day",
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

    fastify.withTypeProvider<ZodTypeProvider>().post(
        "/generate",
        {
            schema: {
                body: z.object({
                    language: z.string().min(1, "Please select your preferred language."),
                    gender: z
                        .string()
                        .min(1, "Please select your gender.")
                        .refine((value) => Genders.includes(value as Gender), "Invalid gender."),
                    birthDate: z
                        .string()
                        .regex(/^\d{4}-\d{2}-\d{2}$/u, "Birth date must be YYYY-MM-DD.")
                        .refine(
                            (date) => {
                                const today = new Date();
                                const minDate = new Date(
                                    today.getFullYear() - MIN_AGE,
                                    today.getMonth(),
                                    today.getDate()
                                );
                                return new Date(date) <= minDate;
                            },
                            {
                                message: `You must be at least ${MIN_AGE} years old.`,
                            }
                        ),
                    birthTime: z
                        .string()
                        .regex(/^\d{2}:\d{2}$/u, "Birth time must be HH:mm.")
                        .nullable(),
                    birthPlace: z.string().min(1, "Please enter your birth place."),
                    birthPlaceLat: z
                        .number()
                        .refine((value) => String(value).length > 0, "Please enter your birth place."),
                    birthPlaceLng: z
                        .number()
                        .refine((value) => String(value).length > 0, "Please enter your birth place."),
                    country: z.string().min(1, "Please select your country."),
                    /**
                     * Checked against the list rather than merely non-empty, the way
                     * `profile/add` already checks it. The first section of the profile is
                     * now about this string — it is named in the prose and it decides what
                     * the whole section says — so an unrecognised value stops being
                     * cosmetic and becomes a profile about a sign that does not exist.
                     */
                    sunSign: z
                        .string()
                        .min(1, "Please select your Sun sign.")
                        .refine((value) => SINGS_MAP.includes(value as ZodiacSign), "Invalid sign."),
                    relationshipStatus: z.string().min(1, "Please select the option that best suits you."),
                    careerStage: z.string().min(1, "Please select the option that best suits you."),
                    decisionStyle: z.string().min(1, "Please select the option that best suits you."),
                    areasOfInterest: z
                        .array(z.string())
                        .min(1, "Please select 1 to 3 options that best suit you.")
                        .max(3, "You can select up to 3 areas of interest."),
                    contentPreference: z.string().min(1, "Please select your content preference."),
                    beliefLevel: z.string().min(1, "Please select your belief level."),
                }),
                response: {
                    200: z.object({
                        data: z.object({
                            sunSign: z.string(),
                            moonSign: z.string(),
                            risingSign: z.string().nullable(),
                            personalityProfile: z.string(),
                            personalityProfileInput: z.string(),
                        }),
                    }),
                    401: z.object({
                        error: z.object({
                            code: z.string(),
                            message: z.string(),
                        }),
                    }),
                    409: z.object({
                        error: z.object({
                            code: z.string(),
                            message: z.string(),
                        }),
                    }),
                    500: z.object({
                        error: z.object({
                            code: z.string(),
                            message: z.string(),
                        }),
                    }),
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

            const detectedTimezone = geoTz(request.body.birthPlaceLat, request.body.birthPlaceLng)[0] || "UTC";

            /**
             * The whole chart in one call, rather than the Moon and the Ascendant computed
             * inline from two raw swisseph calls. Same instant and same house system as
             * before — this route was the last one still building its own chart — and the
             * rest of the placements are what lets the profile be about more than three
             * signs.
             */
            let chart: NatalChart;

            try {
                chart = computeNatalChart({
                    birthDate: request.body.birthDate,
                    birthTime: request.body.birthTime,
                    birthPlaceLat: request.body.birthPlaceLat,
                    birthPlaceLng: request.body.birthPlaceLng,
                    timezone: detectedTimezone,
                }).chart;
            } catch (error: unknown) {
                request.log.error({ err: error }, "Failed to compute natal chart");

                return reply.status(409).send({
                    error: {
                        code: "transit_calculation_error",
                        message: error instanceof Error ? error.message : "Natal chart could not be computed.",
                    },
                });
            }

            const moonSign = chart.moon.sign;

            /**
             * Null without a birth time. The Ascendant moves a full sign roughly every
             * two hours, so deriving it from an assumed noon returns an essentially
             * random sign — null is the honest answer, and the scoring engine skips the
             * Ascendant rather than trusting a fabricated one.
             */
            const risingSign = chart.ascendant?.sign ?? null;

            const language = getLanguageByIso(request.body.language);

            const prompt = buildPrompt({
                chart,
                aspects: findNatalAspects(chart, {
                    personalOnly: true,
                    widenNatalMoon: request.body.birthTime === null,
                }),
                sunSign: request.body.sunSign,
                risingSign,
                relationshipStatus: request.body.relationshipStatus,
                careerStage: request.body.careerStage,
                decisionStyle: request.body.decisionStyle,
                areasOfInterest: request.body.areasOfInterest,
                contentPreference: request.body.contentPreference,
                beliefLevel: request.body.beliefLevel,
                language: language
                    ? buildPromptLanguageRule(language, request.body.gender as Gender)
                    : request.body.language,
            });

            /**
             * Two shapes, chosen once. A reader with no birth time has no Ascendant and
             * therefore no second section, and the response schema, the property order and
             * the parse all have to agree about that.
             */
            const shape = profileShape(risingSign);

            try {
                let personalityProfile: PersonalityProfile | PersonalityProfileWithoutAscendant | null = null;

                // One retry, because most failures here are a timeout or a rate limit
                // rather than anything a second attempt would hit again.
                for (let attempt = 1; attempt <= 2 && !personalityProfile; attempt++) {
                    const startedAt = Date.now();

                    const response = await ai.models.generateContent({
                        model: MODEL,
                        contents: prompt,
                        config: {
                            /**
                             * A small thinking budget, and the only generating route that gets one.
                             *
                             * Measured on the daily prompt, the default budget spends 2 000–9 500 hidden
                             * tokens for nothing but reaching back for the address rule, so that route runs
                             * at zero. This one is different in kind: the three sections are written as
                             * answers to each other, and cross-section planning is the whole design. Left at
                             * zero the model can only avoid repeating itself by reading back what it has
                             * already emitted.
                             *
                             * Small rather than dynamic because the work is planning three sections, not
                             * solving anything — and because this runs while a new reader waits on the
                             * signup screen, where latency is the one cost that is not a rounding error. At
                             * one call per signup the token cost is; the wait is not.
                             */
                            thinkingConfig: { thinkingBudget: 1024 },
                            responseMimeType: "application/json",
                            responseJsonSchema: {
                                ...toResponseJsonSchema(shape.schema),
                                /**
                                 * Google documents property emission order as arbitrary unless this is set,
                                 * and the last section is written as a reading of the ones above it.
                                 */
                                propertyOrdering: shape.ordering,
                            },
                        },
                    });

                    const raw = parseLLMJson<unknown>(response.text ?? "");
                    const parsed = raw === null ? null : shape.schema.safeParse(raw);

                    personalityProfile = parsed?.success ? parsed.data : null;

                    const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
                    /**
                     * Thinking tokens are billed at the output rate but are not part of
                     * `candidatesTokenCount`, so leaving them out under-reported every generation by
                     * 30–45 % while the default budget was on. Counted here so the audit row is what
                     * was actually charged rather than what was visible.
                     */
                    const outputTokens =
                        (response.usageMetadata?.candidatesTokenCount ?? 0) +
                        (response.usageMetadata?.thoughtsTokenCount ?? 0);

                    // Audit only — never allowed to fail onboarding.
                    await fastify.db
                        .insert(aiGenerations)
                        .values({
                            userId: session.user.id,
                            type: "personalityProfile",
                            status: personalityProfile ? "success" : "error",
                            error: personalityProfile
                                ? null
                                : `Unusable answer (finishReason: ${response.candidates?.[0]?.finishReason ?? "unknown"})`,
                            requestId: response.responseId ?? "",
                            provider: "google",
                            model: MODEL,
                            input: prompt,
                            output: response.text ?? "",
                            inputTokens,
                            outputTokens,
                            total_tokens: response.usageMetadata?.totalTokenCount ?? inputTokens + outputTokens,
                            latencyMs: Date.now() - startedAt,
                            cost:
                                (inputTokens / 1_000_000) * PRICE_PER_MILLION.input +
                                (outputTokens / 1_000_000) * PRICE_PER_MILLION.output,
                        })
                        .catch((error: unknown) => request.log.error({ err: error }, "Failed to log AI generation"));
                }

                /**
                 * An empty profile still completes onboarding: the sign-up is worth more
                 * than the text, and the profile can be written again later. It is logged
                 * loudly because everything downstream reads this column — a reader whose
                 * profile is blank gets the generic half of every daily prompt.
                 */
                if (!personalityProfile) {
                    request.log.error({ userId: session.user.id }, "Personality profile came back unusable twice");
                }

                return reply.status(200).send({
                    data: {
                        sunSign: request.body.sunSign,
                        moonSign,
                        risingSign,
                        personalityProfile: JSON.stringify(personalityProfile ?? shape.empty),
                        personalityProfileInput: prompt,
                    },
                });
            } catch (error: unknown) {
                const isDev = process.env.NODE_ENV !== "production";

                request.log.error({ err: error }, "Failed to generate personality profile");

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
