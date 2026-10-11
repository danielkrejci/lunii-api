import { FastifyInstance } from "fastify";
import { z } from "zod";

import { aiGenerations } from "../../db/schema";
import { ai } from "../../lib/ai";
import { buildPromptLanguageRule, getLanguageByIso } from "../../utils/languageUtils";
import { Gender, ZodiacSign } from "../../utils/natalUtils";
import { humanizeEnum, humanizeEnums, parseLLMJson } from "../../utils/stringUtils";
import { toOrderedResponseJsonSchema } from "../../utils/zodResponse";
import {
    Balance,
    dominantElement,
    dominantModality,
    Element,
    findNatalAspects,
    KeyPlacement,
    Modality,
    NatalAspect,
    NatalChart,
    NatalPoint,
    NATAL_POINTS,
    selectKeyPlanets,
} from "../astro";
import { VOICE_RULES } from "../insights/voice";
import {
    CONTEXT_CATEGORIES,
    CONTEXT_ITEMS_PER_CATEGORY,
    ContextCategory,
    PersonalityContext,
    PersonalityOverview,
} from "./schema";

/**
 * The reader's personality profile, which is two things written in one call.
 *
 * The Cosmic Overview is what they see: a card per placement and a closing synthesis.
 * The Personality Context is what they never see: the fuller analysis every other prompt
 * reads to know who it is writing for. Kept apart because the screen wants short and
 * the prompts want depth, and shortening one to fit the other loses either way.
 *
 * Lives here rather than in its route because two callers write it: onboarding, before
 * a profile exists, and the profile update, which rewrites it when the chart, the
 * language, the gender or the answers it was written from change.
 */

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

/* ============================================================
   FACTS
============================================================ */

/**
 * Everything on the screen that is counted rather than written.
 *
 * Worked out here and handed to the model as given, so the labels the reader sees are the
 * same on every rewrite and never something the model miscounted.
 */
export interface ProfileFacts {
    sunSign: ZodiacSign;
    moonSign: ZodiacSign;
    risingSign: ZodiacSign | null;
    element: Balance<Element>;
    modality: Balance<Modality>;
    keyPlanets: KeyPlacement[];
}

export function computeProfileFacts(input: {
    chart: NatalChart;
    aspects: NatalAspect[];
    sunSign: ZodiacSign;
}): ProfileFacts {
    return {
        sunSign: input.sunSign,
        moonSign: input.chart.moon.sign,
        // Absent without a birth time: the Ascendant would be an artefact of an assumed noon.
        risingSign: input.chart.ascendant?.sign ?? null,
        element: dominantElement(input.chart),
        modality: dominantModality(input.chart),
        keyPlanets: selectKeyPlanets(input.chart, input.aspects),
    };
}

/* ============================================================
   ANSWER SHAPE
============================================================ */

/**
 * The answer, as the decoder must return it, built for this one chart.
 *
 * Built per call rather than declared once because two parts of it depend on the chart:
 * a reader with no birth time has no Rising card — the key is absent, so the card is
 * impossible rather than merely discouraged — and the planet cards are keyed by exactly
 * the three planets selected above, so the model cannot write about a fourth.
 *
 * The ORDER is load-bearing: the context is written first, so the cards and the signature
 * are distilled from an analysis that already exists rather than improvised; the signature
 * is last because it is a reading of everything above it. `toOrderedResponseJsonSchema`
 * holds the decoder to that order at every level.
 */
export function buildAnswerSchema(facts: ProfileFacts) {
    const points = NATAL_POINTS.filter((point) => point !== "ascendant" || facts.risingSign !== null);

    const item = z.object({
        text: z.string().min(1),
        points: z.array(z.enum(points as [NatalPoint, ...NatalPoint[]])).min(1),
    });

    const context = z.object(
        Object.fromEntries(
            CONTEXT_CATEGORIES.map((category) => [category, z.array(item).max(CONTEXT_ITEMS_PER_CATEGORY)])
        ) as Record<ContextCategory, z.ZodArray<typeof item>>
    );

    const placement = z.object({ keyword: z.string().min(1), text: z.string().min(1) });
    const line = z.object({ text: z.string().min(1) });

    const overview = z.object({
        sun: placement,
        moon: placement,
        ...(facts.risingSign ? { rising: placement } : {}),
        element: line,
        modality: line,
        planets: z.object(Object.fromEntries(facts.keyPlanets.map(({ planet }) => [planet, line]))),
    });

    return z.object({
        context,
        overview,
        signature: z.object({ summary: z.array(z.string().min(1)).min(2).max(3) }),
    });
}

type Answer = {
    context: PersonalityContext;
    overview: {
        sun: { keyword: string; text: string };
        moon: { keyword: string; text: string };
        rising?: { keyword: string; text: string };
        element: { text: string };
        modality: { text: string };
        planets: Record<string, { text: string }>;
    };
    signature: { summary: string[] };
};

function card(sign: ZodiacSign, written?: { keyword: string; text: string }) {
    return { sign, keyword: written?.keyword.trim() ?? "", text: written?.text.trim() ?? "" };
}

/**
 * The screen, assembled from the facts and whatever the model wrote.
 *
 * With no answer every text is empty and every fact is still there: the screen still
 * shows the reader's signs, element and planets, which is better than the blank
 * profile a failed generation used to leave behind.
 */
export function buildOverview(facts: ProfileFacts, answer: Answer | null): PersonalityOverview {
    return {
        sun: card(facts.sunSign, answer?.overview.sun),
        moon: card(facts.moonSign, answer?.overview.moon),
        rising: facts.risingSign ? card(facts.risingSign, answer?.overview.rising) : null,
        element: { ...facts.element, text: answer?.overview.element.text.trim() ?? "" },
        modality: { ...facts.modality, text: answer?.overview.modality.text.trim() ?? "" },
        keyPlanets: facts.keyPlanets.map((placement) => ({
            ...placement,
            text: answer?.overview.planets[placement.planet]?.text.trim() ?? "",
        })),
        signature: {
            summary: (answer?.signature.summary ?? []).map((paragraph) => paragraph.trim()).filter(Boolean),
        },
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

function describeDistribution(balance: Balance<string>): string {
    return Object.entries(balance.distribution)
        .map(([key, weight]) => `${key} ${weight}`)
        .join(", ");
}

export function buildPrompt(input: {
    chart: NatalChart;
    aspects: NatalAspect[];
    facts: ProfileFacts;
    relationshipStatus: string;
    careerStage: string;
    decisionStyle: string;
    areasOfInterest: string[];
    contentPreference: string;
    beliefLevel: string;
    language: string;
}): string {
    const { chart, facts } = input;

    const decisionStyle = humanizeEnum(input.decisionStyle);
    const careerStage = humanizeEnum(input.careerStage);
    const relationshipStatus = humanizeEnum(input.relationshipStatus);
    const interests = humanizeEnums(input.areasOfInterest).join(", ");

    const keyPlanets = facts.keyPlanets
        .map(({ planet, sign, retrograde }) => `${planet} in ${sign}${retrograde ? " (retrograde)" : ""}`)
        .join(", ");

    /**
     * The Rising card, or nothing at all. Without a birth time the Ascendant is an
     * artefact of an assumed noon, so the card is simply absent and the reader is never
     * told why — the app shows them where to add a birth time instead.
     */
    const risingBrief = facts.risingSign
        ? `- rising — their Rising sign, ${facts.risingSign}: the first impression, what a room reads
  in the first ten minutes, and how that differs from who they turn out to be.
`
        : "";

    return `==================================================
LANGUAGE AND FORM OF ADDRESS
==================================================

${input.language}

This governs every field you return. It is repeated at the end; check it again before you
answer.

You are writing about a new user of an astrology app, and you are writing two things at
once:

- A private analysis the app keeps and never shows them. Everything it writes them later
  — the daily horoscope, the Moon screen, compatibility, the chat — reads this to know who
  it is talking to. It has to be deep, specific and honest.
- The profile screen they read right after signing up: short cards about their placements
  and one closing synthesis. It decides whether they believe this app knows them.

==================================================
THEIR CHART
==================================================

Sun: ${facts.sunSign}
Moon: ${facts.moonSign}
Rising: ${facts.risingSign ?? "unknown — no birth time was given"}
Mercury: ${chart.mercury.sign}
Venus: ${chart.venus.sign}
Mars: ${chart.mars.sign}
Jupiter: ${chart.jupiter.sign}
Saturn: ${chart.saturn.sign}

What the chart does to itself — the tensions and supports they carry permanently:

${describeNatalAspects(input.aspects)}

Already worked out — these are facts, shown to the reader as labels. Never contradict them
and never recount them:

Dominant element: ${facts.element.key} (${describeDistribution(facts.element)})
Dominant modality: ${facts.modality.key} (${describeDistribution(facts.modality)})
Key planets: ${keyPlanets}

==================================================
THEM
==================================================

Decides by: ${decisionStyle}
Career right now: ${careerStage}
Relationship: ${relationshipStatus}
Cares about: ${interests}

These are internal English labels for what they picked during sign-up. Never repeat one
back, never translate one word for word. Let the answer decide what you say, then say the
thing itself.

==================================================
PART 1 — context (private, written first)
==================================================

The analysis the rest of the app runs on. Write it first and write it properly: the cards
and the signature below are distilled from it.

Five categories, each 0 to ${CONTEXT_ITEMS_PER_CATEGORY} observations:

- corePatterns — how they actually operate: how they decide, what drives them, what they
  do by default when nobody is watching.
- innerTensions — where two parts of them want different things, and what that looks like
  from the outside. The standing aspects above are the main material here.
- emotionalPatterns — what makes them feel safe, what unsettles them, how they react
  under pressure and how they recover.
- relationshipPatterns — how they connect, communicate, show care and hold back with the
  people close to them.
- workPatterns — how they take on responsibility, what motivates them, where they stall.

Each observation:

- text: one to three sentences of behaviour, specific enough that it would be wrong about
  most other people. Use their life as the setting — the relationship they are in, the
  stage their career is at, what they care about — without naming it. NO astrology
  vocabulary at all: no sign, no planet, no Ascendant, no element, no aspect. The prompts
  that read this are forbidden that vocabulary, and whatever sits in their context gets
  echoed.
- points: the chart points the observation stands on, as keys from the chart above
  (sun, moon, ascendant, mercury, venus, mars, jupiter, saturn, uranus, neptune, pluto).
  Name only the ones that genuinely produce it.

Two tests, and every observation has to pass both:

- Swap in a different chart, same sign-up answers. If the observation still holds, the
  chart is missing — it is a description of their form, not of them.
- Read it as someone with any other chart. If it is true of most people ("you have a
  curious mind", "you value honesty"), it is a horoscope column. Cut it.

Their sign-up answers are the setting, never the content. "You follow your gut when you
decide" or "you research before committing" is their form read back to them, and the
prompts that read this already have the form. Say what the chart does with it instead —
what following their gut costs them, where the research stops being useful.

Leave a category empty rather than invent something the chart does not support. Never say
the same thing twice across categories — a tension written once under innerTensions does
not reappear under relationshipPatterns in other words.

This is analysis, not advice. Say what is true of them. Never what they should do.

==================================================
PART 2 — overview (the cards they see)
==================================================

Each card is one placement at a time, and each one names it. These are about the chart
only: no fact from their sign-up answers belongs on a card — the signature has them.

- sun — their Sun sign, ${facts.sunSign}: core identity, what they are like once people
  know them.
- moon — their Moon sign, ${facts.moonSign}: the emotional world, what happens inside that
  others do not see.
${risingBrief}- element — what having ${facts.element.key} as the dominant element means for how they
  move through life. Not a definition of the element: what it does in them.
- modality — what being mostly ${facts.modality.key} means for how they start, keep up and let
  go of things.
- planets — one card each for ${keyPlanets}. The app already shows which area of life each
  planet stands for, so never open by explaining it ("Venus rules love…"). Say how this
  placement plays out in this person, coloured by what the planet does with the rest of
  the chart.

Every card:

- keyword (Sun, Moon and Rising only): one to three words that name the quality, never the
  sign itself. It sits on a small card next to two others.
- text: ONE sentence, at most twenty words. Concrete, about behaviour, true of this person.

The cards are the way in, not the reading. A card that runs long is one that kept
explaining the sign after it had finished.

==================================================
PART 3 — signature (written last)
==================================================

The most important text on the screen, and the only one that may not be read anywhere
above it.

- summary: two or three paragraphs, two to four sentences each — six to nine sentences in
  all. One paragraph per array entry; never a line break inside one.

  It connects their main placements and says how they work together in this person, and
  each paragraph does a different job:

  1. How the placements combine into one way of being — the thing that only exists
     because these particular pieces sit together in one person.
  2. Where that shows in their life. This is where their sign-up answers come in, unnamed:
     let them decide which part of the chart you put weight on, and land it in the rooms
     they actually live in.
  3. (When the chart supports it) the tension underneath — what people misread about
     them, or what the combination costs them — taken from what you found in part 1.

  Open on them, not on a category of person: never "You are a woman who…", "You are a
  man of…", "You are someone who…". It must say something none of the cards said. If a
  sentence could stand on one card, it does not belong here. A paragraph that restates
  the one above it in richer words is the failure to watch for.

==================================================
OUTPUT
==================================================

Return ONLY valid JSON in this order: context, then overview, then signature.

No markdown and no headings. Count sentences, not characters. Describe patterns and
behaviour, never labels or traits.

Nothing about "the universe", "cosmic energy", "the cosmos", or "you are destined".

==================================================
HOW TO WRITE IT
==================================================

${VOICE_RULES}

A PERSON, NOT A DAY

Take the register from the rules above — plain words, real situations, one idea per
sentence — and throw their tense away. They are written for a horoscope, so every example
in them says "today". There is no today here.

Everything here is true of this person in general: last year, this month, next spring.
Present tense, and permanent.

  Wrong: "today you will want to think it over before you answer"
  Right: "you think things over before you answer, and being rushed is what you resent"

Two things are banned outright, in any language:

- any word that fixes it to a moment — "today", "this week", "right now", "at the moment",
  "currently", "lately"
- any instruction to go and do something — "try", "start", "ask them", "pick one". You are
  describing a person, not giving them a task.

NAME THE ASTROLOGY ON THE CARDS — THIS IS THE EXCEPTION

The writing rules above forbid naming a planet, a sign, an aspect or the Ascendant. On the
cards (part 2) that ban is lifted: this is the first thing they read after signing up to
an astrology app, and they came to find out what their placements say about them. Name the
signs and planets there. In part 1 the ban stands in full. In the signature, name a
placement only where the sentence needs it.

NAME THE PLANETS, NEVER THE ANGLE BETWEEN THEM

Two planets are "pulling against each other", "working together", "putting pressure on"
one another. Never name the aspect itself — not conjunction, not square, not trine,
opposition or sextile, in any language. It is a word the reader would have to look up, and
one you can get wrong about their chart. Never reach for a vague substitute either —
"because of the influences in your chart".

No jargon with no payoff: degrees, orbs, houses, "cusp", "natal", "chart ruler". One clause
of mechanism at most, then the person.

They describe their belief in astrology as "${humanizeEnum(input.beliefLevel)}" and prefer
content that is "${humanizeEnum(input.contentPreference)}". Match that register. Never
write about it.

Respond only in:
${input.language}`;
}

/* ============================================================
   GENERATE
============================================================ */

export interface PersonalityInput {
    /** Whose generation this is, for the audit row. */
    userId: string;
    chart: NatalChart;
    /** Without a birth time the Moon could sit anywhere in a day's arc, so its orb widens. */
    hasBirthTime: boolean;
    sunSign: ZodiacSign;
    relationshipStatus: string;
    careerStage: string;
    decisionStyle: string;
    areasOfInterest: string[];
    contentPreference: string;
    beliefLevel: string;
    languageIso: string;
    gender: Gender;
}

export interface PersonalityResult {
    /** Always complete as facts; the texts are empty when the model failed. */
    overview: PersonalityOverview;
    /** Null when the model answered twice with something unusable. */
    context: PersonalityContext | null;
    /** The prompt, stored alongside for auditing what the profile was written from. */
    input: string;
}

/**
 * Writes the profile, with one retry.
 *
 * A null `context` means the model failed twice, and what that means is the caller's
 * call: onboarding stores the facts-only overview rather than lose the sign-up, an update
 * refuses to replace a working profile with it.
 */
export async function generatePersonalityProfile(
    fastify: FastifyInstance,
    input: PersonalityInput
): Promise<PersonalityResult> {
    const language = getLanguageByIso(input.languageIso);

    const aspects = findNatalAspects(input.chart, {
        personalOnly: true,
        widenNatalMoon: !input.hasBirthTime,
    });

    const facts = computeProfileFacts({ chart: input.chart, aspects, sunSign: input.sunSign });

    const prompt = buildPrompt({
        chart: input.chart,
        aspects,
        facts,
        relationshipStatus: input.relationshipStatus,
        careerStage: input.careerStage,
        decisionStyle: input.decisionStyle,
        areasOfInterest: input.areasOfInterest,
        contentPreference: input.contentPreference,
        beliefLevel: input.beliefLevel,
        language: language ? buildPromptLanguageRule(language, input.gender) : input.languageIso,
    });

    const schema = buildAnswerSchema(facts);

    let answer: Answer | null = null;

    // One retry, because most failures here are a timeout or a rate limit
    // rather than anything a second attempt would hit again.
    for (let attempt = 1; attempt <= 2 && !answer; attempt++) {
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
                 * at zero. This one is different in kind: the cards and the signature are
                 * distilled from the analysis written before them, and cross-section planning
                 * is the whole design.
                 *
                 * Small rather than dynamic because this runs while a new reader waits on the
                 * signup screen, where latency is the one cost that is not a rounding error.
                 */
                thinkingConfig: { thinkingBudget: 1024 },
                responseMimeType: "application/json",
                responseJsonSchema: toOrderedResponseJsonSchema(schema),
            },
        });

        const raw = parseLLMJson<unknown>(response.text ?? "");
        const parsed = raw === null ? null : schema.safeParse(raw);

        answer = parsed?.success ? (parsed.data as Answer) : null;

        const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
        /**
         * Thinking tokens are billed at the output rate but are not part of
         * `candidatesTokenCount`, so leaving them out under-reported every generation by
         * 30–45 % while the default budget was on. Counted here so the audit row is what
         * was actually charged rather than what was visible.
         */
        const outputTokens =
            (response.usageMetadata?.candidatesTokenCount ?? 0) + (response.usageMetadata?.thoughtsTokenCount ?? 0);

        // Audit only — never allowed to fail onboarding.
        await fastify.db
            .insert(aiGenerations)
            .values({
                userId: input.userId,
                type: "personalityProfile",
                status: answer ? "success" : "error",
                error: answer
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
            .catch((error: unknown) => fastify.log.error({ err: error }, "Failed to log AI generation"));
    }

    return {
        overview: buildOverview(facts, answer),
        context: answer ? trimContext(answer.context) : null,
        input: prompt,
    };
}

/** Whitespace off every observation, and an observation that is nothing but whitespace dropped. */
function trimContext(context: PersonalityContext): PersonalityContext {
    return Object.fromEntries(
        CONTEXT_CATEGORIES.map((category) => [
            category,
            context[category]
                .map((item) => ({ ...item, text: item.text.trim() }))
                .filter((item) => item.text.length > 0),
        ])
    ) as PersonalityContext;
}
