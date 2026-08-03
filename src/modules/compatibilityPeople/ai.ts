import { ai } from "../../lib/ai";
import { Gender, Relationship, ZodiacSign } from "../../utils/natalUtils";
import { parseLLMJson } from "../../utils/stringUtils";
import { Category, RelationshipCategory } from "./types";

export interface DailyOverviewResponse {
    overview: string;
    positiveOverview: {
        title: string;
        description: string;
        reason: string;
    };
    negativeOverview: {
        title: string;
        description: string;
        reason: string;
    };
    insights: {
        title: string;
        description: string;
        reason: string;
        category: RelationshipCategory;
        direction: "positive" | "neutral" | "negative";
    }[];
    practicalAdvice: string;
}

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

        ${language} language.

        ==================================================
        INPUT DATA
        ==================================================

        ${JSON.stringify(input, null, 2)}
        `;
}

export async function generateDailyOverview(language: string, input: DailyCompatibilityAiInput) {
    const prompt = buildPrompt(language, input);

    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
            temperature: 0.5,
            responseMimeType: "application/json",
        },
    });

    const text = response.text ?? "";

    // console.log(JSON.stringify(input, null, 2));
    // console.log(text);

    const result = parseLLMJson<DailyOverviewResponse>(text);

    if (!result) {
        throw new Error("Failed to parse horoscope response");
    }

    return {
        response: result,
        input: prompt,
    };
}
