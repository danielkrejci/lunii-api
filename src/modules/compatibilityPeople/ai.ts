import { z } from "zod";

import { ai } from "../../lib/ai";
import { buildPromptLanguageRule, getLanguageByIso } from "../../utils/languageUtils";
import { Gender, Relationship, ZodiacSign } from "../../utils/natalUtils";
import { parseLLMJson } from "../../utils/stringUtils";
import { toResponseJsonSchema } from "../../utils/zodResponse";
import { Category, INSIGHT_DIRECTIONS, RELATIONSHIP_CATEGORIES } from "./types";

const overviewBlockSchema = z.object({
    title: z.string(),
    description: z.string(),
    reason: z.string(),
});

/**
 * Handed to the model as its response schema, so the decoder cannot emit anything that
 * does not fit — a single missing brace in one array element used to throw the whole
 * answer away. It is also the one definition of the shape: the type is derived from it
 * and the answer is validated against it on the way back.
 */
export const dailyOverviewSchema = z.object({
    overview: z.string(),
    positiveOverview: overviewBlockSchema,
    negativeOverview: overviewBlockSchema,
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
});

export type DailyOverviewResponse = z.infer<typeof dailyOverviewSchema>;

// export type DailyOverviewResponse = {
//     overview: string;
//     positiveOverview: {
//         description: string;
//         reason: string;
//     };
//     negativeOverview: {
//         description: string;
//         reason: string;
//     };
//     practicalAdvice: string;
// };

export type AiAspect = {
    title: string;
    category: Category;
    description: string;
    score: number;
};

export type DailyCompatibilityAiInput = {
    score: number;
    modifier: number;

    positiveTotal: number;
    negativeTotal: number;

    breakdown: {
        emotional: number;
        love: number;
        communication: number;
        motivation: number;
    };

    relationshipType: Relationship;

    personA: {
        name: string;
        sunSign: ZodiacSign;
        gender: Gender;
    };

    personB: {
        name: string;
        sunSign: ZodiacSign;
        gender: Gender;
    };

    positiveAspects: AiAspect[];
    negativeAspects: AiAspect[];
};

function buildPrompt(language: string, input: DailyCompatibilityAiInput) {
    return `
        You are writing a daily compatibility interpretation for two people.

        Your task is to interpret the provided astrological compatibility data for ONE specific day.

        The interpretation must feel insightful, natural and personalized while remaining completely grounded in the supplied data.

        Never invent influences that are not present.

        ==================================================
        OUTPUT
        ==================================================

        Return ONLY valid JSON in exactly this format:

        {
        "overview": "...",

        "positiveOverview": {
            "title": "...",
            "description": "...",
            "reason": "..."
        },

        "negativeOverview": {
            "title": "...",
            "description": "...",
            "reason": "..."
        },

        "insights": [
            {
            "title": "...",
            "description": "...",
            "reason": "...",
            "category": "...",
            "direction": "..."
            }
        ],

        "practicalAdvice": "..."
        }

        ==================================================
        GENERAL RULES
        ==================================================

        Everything must be based ONLY on the supplied input.
        Never invent planetary influences.
        Never mention scores, weights or technical values.
        Write naturally.
        Avoid generic horoscope language.
        Avoid dramatic, fatalistic or absolute statements.
        Do not repeat the same ideas across multiple sections.
        Every section should contribute something different.
        The response should feel like an experienced astrologer translating astrology into practical relationship guidance.

        ==================================================
        ASTROLOGY VISIBILITY
        ==================================================

        The following fields must NEVER mention:

        - astrology
        - planets
        - aspects
        - conjunction
        - trine
        - sextile
        - square
        - opposition
        - zodiac signs

        Fields:

        - overview
        - positiveOverview.description
        - negativeOverview.description
        - insights[].description
        - practicalAdvice

        The following fields SHOULD explain the astrological causes:

        - positiveOverview.reason
        - negativeOverview.reason
        - insights[].reason

        For these fields:

        Mention planets naturally.
        Mention at most two important aspects.
        Explain HOW the planetary energies work together.
        Do NOT simply list aspects.

        Good:
        "Mercury's harmonious connection with the Sun encourages honest communication, while the Moon adds emotional openness."

        Bad:
        "Mercury trine Sun. Moon sextile Venus."

        ==================================================
        OVERVIEW
        ==================================================

        Write 2–3 short sentences.

        Maximum 220 characters.

        Do NOT mention either person's name.

        Do NOT refer to "Person A", "Person B" or their names.

        Always write about the relationship using neutral language such as:

        - you
        - the relationship
        - your connection
        - each other

        Never write:

        "Daniel..."
        "Sarah..."
        "Daniel and Sarah..."

        Instead write:

        "You may feel emotionally closer today."

        or

        "Communication flows naturally today."

        Mention both opportunities and challenges.

        ==================================================
        POSITIVE OVERVIEW
        ==================================================

        title
        2-4 words.

        Examples:
        Communication
        Emotional Connection
        Mutual Support
        Shared Plans
        Trust
        Confidence
        Patience

        description
        1-2 sentences.
        Maximum 180 characters.
        Describe the strongest positive influence of the day.
        Focus on real-life situations.
        No astrology.

        reason
        1-2 sentences.
        Maximum 260 characters.
        Explain why this strength appears today.
        Mention only the most important planetary influences.
        Base the explanation ONLY on the supplied positive aspects.

        ==================================================
        NEGATIVE OVERVIEW
        ==================================================

        title
        2-4 words.

        description
        1-2 sentences.
        Maximum 180 characters.
        Describe today's biggest challenge.
        Explain what could become difficult.
        No astrology.

        reason
        1-2 sentences.
        Maximum 260 characters.
        Explain which planetary influences create this challenge.
        Base the explanation ONLY on the supplied negative aspects.

        ========================
        INSIGHTS
        ========================

        Generate EXACTLY five insights.

        Each insight represents one relationship area.

        The five categories MUST be:

        - emotional
        - chemistry
        - communication
        - trust
        - longTerm

        Generate exactly one insight for every category.

        Each insight must contain:

        title
        description
        reason
        category
        direction

        --------------------------------

        Source data

        The supplied input contains:

        - positiveAspects
        - negativeAspects

        Each aspect already belongs to one relationship category.

        Use BOTH arrays.

        Do not ignore either positive or negative influences.

        --------------------------------

        category

        Must be exactly one of:

        - emotional
        - chemistry
        - communication
        - trust
        - longTerm

        Generate exactly one insight for each category.

        --------------------------------

        direction

        Determine the overall direction of this relationship area.

        Choose exactly one:

        - positive
        - neutral
        - negative

        The direction should reflect the overall balance of ALL supplied aspects belonging to this category.

        Positive

        Supportive influences clearly dominate.

        Neutral

        Supportive and challenging influences are balanced or mixed.

        Negative

        Challenging influences dominate.

        Do NOT force a positive or negative result.

        Multiple categories may have the same direction.

        --------------------------------

        How to evaluate

        For each relationship category:
        1. Collect ALL positive aspects belonging to this category.
        2. Collect ALL negative aspects belonging to this category.
        3. Calculate:

        positiveScore = sum(score of all positive aspects)
        negativeScore = sum(abs(score) of all negative aspects)

        4. Compare the totals.

        If positiveScore is significantly higher than negativeScore:
        direction = positive

        If negativeScore is significantly higher than positiveScore:
        direction = negative

        If the totals are close:
        direction = neutral

        The comparison MUST be based primarily on the numerical score values.

        Do NOT decide based on:

        - number of aspects
        - wording of titles
        - wording of descriptions

        The score already represents the importance, orb strength and planetary weighting.
        Always use the score values as the primary signal.
        Only after determining the direction should you write the description and reason.
        The written interpretation must be consistent with the calculated direction.

        Example:

        Love

        Positive aspects:

        +12.4
        +7.3

        Negative aspects:

        -7.1
        -4.9

        positiveScore = 19.7
        negativeScore = 12.0

        Result:
        direction = positive

        Although some differences exist, the supportive influences are stronger overall.

        --------------------------------

        Motivation

        Positive aspects:

        +5.7

        Negative aspects:

        -10.1

        positiveScore = 5.7
        negativeScore = 10.1

        Result:

        direction = negative
        The challenging influences outweigh the supportive ones today.

        --------------------------------

        title

        1–3 words.
        Create a natural user-facing title.
        The title does NOT need to match the category name.

        Good examples:
        Emotional Balance
        Mutual Understanding
        Different Priorities
        Natural Chemistry
        Growing Trust
        Shared Direction
        Open Communication
        Constructive Dialogue

        --------------------------------

        description

        1–2 short sentences.
        Maximum 100 characters.
        Explain what this means in everyday life.
        Do NOT mention astrology.

        If both supportive and challenging influences exist, naturally acknowledge both while remaining consistent with the overall direction.

        --------------------------------

        reason
        2–3 short sentences.
        Maximum 180 characters.
        Explain WHY this relationship area received its direction.
        Mention the most important planets.
        Mention at most two planetary aspects.
        Explain how they interact.
        Do NOT simply list aspects.

        If both positive and negative influences contributed, explain how they balance each other and why the overall result is positive, neutral or negative.

        ==================================================
        PRACTICAL ADVICE
        ==================================================

        2-3 short sentences.
        Maximum 180 characters.
        Actionable.
        Optimistic.
        Specific.
        Naturally combine today's opportunities and today's challenges.
        No astrology.
        Avoid generic advice.

        ==================================================
        RELATIONSHIP CONTEXT
        ==================================================

        Relationship types:

        - partner
        - crush
        - friend
        - family
        - coworker
        - acquaintance

        Adapt every section to the relationship type.

        Examples:

        partner

        - intimacy
        - affection
        - quality time
        - shared decisions

        crush

        - openness
        - curiosity
        - patience

        friend

        - support
        - trust
        - shared experiences

        family

        - respect
        - understanding
        - patience

        coworker

        - communication
        - cooperation
        - professionalism

        acquaintance

        - openness
        - politeness
        - building rapport

        Never use romantic language unless relationshipType is:

        - partner
        - crush

        ==================================================
        PEOPLE
        ==================================================

        Relationship type: ${input.relationshipType}

        Person A

        name: ${input.personA.name}
        gender: ${input.personA.gender}
        sun sign: ${input.personA.sunSign}

        Person B

        name: ${input.personB.name}
        gender: ${input.personB.gender}
        sun sign: ${input.personB.sunSign}


        Use gender only for grammatically correct language.

        Treat zodiac signs only as internal context.

        Never mention zodiac signs.

        Respond ONLY in:

        ${language}

        ==================================================
        INPUT DATA
        ==================================================

        ${JSON.stringify(input, null, 2)}
        `;
}

const MODEL = "gemini-2.5-flash";

/** List price per million tokens, so the logged cost is what was actually charged. */
const PRICE_PER_MILLION = { input: 0.3, output: 2.5 };

/**
 * Never throws on a bad answer: the caller logs every call, successful or not, so a
 * parse failure has to come back with its metrics attached.
 */
export async function generateDailyOverview(
    languageIso: string,
    input: DailyCompatibilityAiInput
): Promise<{
    content: DailyOverviewResponse | null;
    usage: {
        requestId: string;
        provider: string;
        model: string;
        input: string;
        output: string;
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        latencyMs: number;
        cost: number;
        error: string | null;
    };
}> {
    const language = getLanguageByIso(languageIso);

    const prompt = buildPrompt(language ? buildPromptLanguageRule(language) : languageIso, input);

    const startedAt = Date.now();

    const response = await ai.models.generateContent({
        model: MODEL,
        contents: prompt,
        config: {
            temperature: 0.5,
            responseMimeType: "application/json",
            responseJsonSchema: toResponseJsonSchema(dailyOverviewSchema),
        },
    });

    const text = response.text ?? "";

    const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;

    const usage = {
        requestId: response.responseId ?? "",
        provider: "google",
        model: MODEL,
        input: prompt,
        output: text,
        inputTokens,
        outputTokens,
        totalTokens: response.usageMetadata?.totalTokenCount ?? inputTokens + outputTokens,
        latencyMs: Date.now() - startedAt,
        cost:
            (inputTokens / 1_000_000) * PRICE_PER_MILLION.input + (outputTokens / 1_000_000) * PRICE_PER_MILLION.output,
        error: null as string | null,
    };

    const raw = parseLLMJson<unknown>(text);
    const parsed = raw === null ? null : dailyOverviewSchema.safeParse(raw);

    if (!parsed?.success) {
        /**
         * `finishReason` alone does not explain a rejected answer — `STOP` means the
         * model finished cleanly and the fault is on this side of the wire. Say which of
         * the three it was, or the next failure costs another read of the raw output.
         */
        const issue = parsed?.error.issues[0];

        const reason = text.trim()
            ? issue
                ? `answer does not match the schema at "${issue.path.join(".")}": ${issue.message}`
                : "answer could not be parsed as JSON"
            : "model returned no text";

        return {
            content: null,
            usage: {
                ...usage,
                error: `${reason} (finishReason: ${response.candidates?.[0]?.finishReason ?? "unknown"}, ${text.length} chars)`,
            },
        };
    }

    return { content: parsed.data, usage };
}
