import { z } from "zod";

import { ai } from "../../lib/ai";
import { buildPromptLanguageRule, getLanguageByIso } from "../../utils/languageUtils";
import { ZodiacSign } from "../../utils/natalUtils";
import { getLLMJson, parseLLMJson } from "../../utils/stringUtils";
import { toResponseJsonSchema } from "../../utils/zodResponse";
import { MAX_ORBS, orbStrength, Planet as AstroPlanet, Planet, PLANETS } from "../astro";
import { ASPECT_STRENGTH } from "../dailyScore/factors";
import { DailyScoreResult, PlanetInfluence as PlanetWeight } from "../dailyScore/types";
import { getMoonPhase } from "../transits";
import { ASPECT_PROFILES } from "./aspectProfiles";
import { PLANET_PROFILES } from "./planetProfiles";
import { SIGN_PROFILES } from "./signProfiles";

// ============================================================
// ADVANCED ASTRO ENGINE
// FULL VERSION
// ============================================================

/* ============================================================
   TYPES
============================================================ */

export type { Planet };

export type AspectType = "conjunction" | "opposition" | "square" | "trine" | "sextile";

export type ThemeCategory =
    | "emotional"
    | "social"
    | "mental"
    | "romantic"
    | "energetic"
    | "reflective"
    | "transformational";

export type LifeArea = "love" | "career" | "health" | "mood";

/* ============================================================
   THEMES
============================================================ */

export type Theme =
    | "confidence"
    | "visibility"
    | "self_expression"
    | "clarity"
    | "identity"
    | "motivation"
    | "recognition"
    | "emotion"
    | "sensitivity"
    | "reflection"
    | "comfort"
    | "nostalgia"
    | "intuition"
    | "mood_shift"
    | "emotional_need"
    | "communication"
    | "curiosity"
    | "mental_clarity"
    | "overthinking"
    | "analysis"
    | "conversation"
    | "misunderstanding"
    | "adaptability"
    | "love"
    | "connection"
    | "attraction"
    | "warmth"
    | "romance"
    | "beauty"
    | "affection"
    | "social_ease"
    | "restlessness"
    | "frustration"
    | "impulsiveness"
    | "desire_for_progress"
    | "conflict"
    | "energy"
    | "impatience"
    | "assertiveness"
    | "optimism"
    | "growth"
    | "possibility"
    | "exploration"
    | "freedom"
    | "hope"
    | "openness"
    | "discipline"
    | "pressure"
    | "responsibility"
    | "restraint"
    | "seriousness"
    | "fatigue"
    | "patience"
    | "stability"
    | "change"
    | "surprise"
    | "rebellion"
    | "instability"
    | "breakthrough"
    | "independence"
    | "unpredictability"
    | "dreaminess"
    | "confusion"
    | "idealism"
    | "fantasy"
    | "escapism"
    | "longing"
    | "blurred_boundaries"
    | "transformation"
    | "obsession"
    | "emotional_depth"
    | "power"
    | "control"
    | "release"
    | "inner_shift"
    | "hidden_tension"
    | "compassion"
    | "balance"
    | "cooperation"
    | "awareness"
    | "challenge"
    | "resilience"
    | "ease"
    | "flow"
    | "focus"
    | "intensity";

/* ============================================================
   TRANSITS
============================================================ */

export interface TransitPlanet {
    sign: ZodiacSign;
    longitude: number;
}

export interface TransitAspect {
    planets: [Planet, Planet];
    type: AspectType;
    orb: number;
}

export interface DailyTransits {
    planets: Record<Planet, TransitPlanet>;
    aspects: TransitAspect[];
}

/* ============================================================
   RESULT TYPES
============================================================ */

/* ============================================================
   THEME SCORING
============================================================ */

export interface ThemeScore {
    theme: Theme;
    score: number;
}

export function scoreThemes(influences: ProfileInfluence[]): ThemeScore[] {
    const scores: Partial<Record<Theme, number>> = {};

    function add(theme: Theme, value: number) {
        scores[theme] = (scores[theme] ?? 0) + value;
    }

    for (const influence of influences) {
        for (const theme of influence.profile.themes) {
            add(theme, influence.score);
        }
    }

    return Object.entries(scores)
        .map(([theme, score]) => ({
            theme: theme as Theme,
            score,
        }))
        .sort((a, b) => b.score - a.score);
}

export interface EnergyProfile {
    activity: number;
    emotion: number;
    intellect: number;
    spirituality: number;
}

export function aggregateEnergy(influences: ProfileInfluence[]): EnergyProfile {
    const result: EnergyProfile = {
        activity: 0,
        emotion: 0,
        intellect: 0,
        spirituality: 0,
    };

    for (const influence of influences) {
        if (influence.type !== "planet") {
            continue;
        }

        result.activity += influence.profile.energy.activity * influence.score;
        result.emotion += influence.profile.energy.emotion * influence.score;
        result.intellect += influence.profile.energy.intellect * influence.score;
        result.spirituality += influence.profile.energy.spirituality * influence.score;
    }

    return result;
}

export type EnergyDimension = "activity" | "emotion" | "intellect" | "spirituality";

export function getDominantEnergy(energy: EnergyProfile): EnergyDimension {
    return Object.entries(energy).sort((a, b) => b[1] - a[1])[0][0] as EnergyDimension;
}

export function deriveAtmosphere(input: { energy: EnergyProfile; dominantPlanet?: DominantPlanet }) {
    const dominantEnergy = getDominantEnergy(input.energy);

    let emotionalTone = "balanced";

    switch (dominantEnergy) {
        case "activity":
            emotionalTone = "dynamic";
            break;

        case "emotion":
            emotionalTone = "sensitive";
            break;

        case "intellect":
            emotionalTone = "thoughtful";
            break;

        case "spirituality":
            emotionalTone = "introspective";
            break;
    }

    let planetaryAtmosphere = "balanced";

    switch (input.dominantPlanet?.planet) {
        case "venus":
            planetaryAtmosphere = "socially open";
            break;

        case "mars":
            planetaryAtmosphere = "driven and restless";
            break;

        case "saturn":
            planetaryAtmosphere = "serious and reflective";
            break;

        case "neptune":
            planetaryAtmosphere = "dreamlike and intuitive";
            break;

        case "pluto":
            planetaryAtmosphere = "deep and transformative";
            break;

        case "moon":
            planetaryAtmosphere = "emotionally heightened";
            break;

        case "sun":
            planetaryAtmosphere = "confident and expressive";
            break;

        case "mercury":
            planetaryAtmosphere = "mentally active";
            break;

        case "jupiter":
            planetaryAtmosphere = "optimistic and expansive";
            break;

        case "uranus":
            planetaryAtmosphere = "unexpected and innovative";
            break;
    }

    return {
        dominantEnergy,
        emotionalTone,
        planetaryAtmosphere,
    };
}

/* ============================================================
   OBSERVATION GENERATOR
============================================================ */

export function generateObservations(scores: ThemeScore[]): string[] {
    const observations: string[] = [];

    const topThemes = scores.slice(0, 8).map((x) => x.theme);

    topThemes.forEach((theme) => {
        const seeds = OBSERVATION_SEEDS[theme];

        if (!seeds?.length) {
            return;
        }

        const random = seeds[Math.floor(Math.random() * seeds.length)];

        observations.push(random);
    });

    return [...new Set(observations)].slice(0, 5);
}

/* ============================================================
   OBSERVATION SEEDS
============================================================ */

export const OBSERVATION_SEEDS: Partial<Record<Theme, string[]>> = {
    conflict: [
        "small reactions may escalate faster than expected",
        "people may sound sharper than they intend",
        "frustration builds through small interruptions",
    ],
    overthinking: [
        "you may replay conversations more than usual",
        "small uncertainties become mentally loud",
        "reading between the lines becomes exhausting",
    ],
    connection: [
        "someone may open up unexpectedly",
        "small interactions feel emotionally meaningful",
        "warmth appears in subtle moments",
    ],
    communication: [
        "conversations move quickly but not always clearly",
        "someone may say more than they intended",
        "tone matters more than words today",
    ],
    restlessness: [
        "staying still may feel unusually difficult",
        "patience becomes inconsistent during the day",
        "you may crave movement or change",
    ],
    emotional_need: [
        "emotional reassurance feels more important than usual",
        "distance from others may feel stronger today",
        "you may notice what feels emotionally missing",
    ],
    confusion: [
        "people may feel harder to read today",
        "mixed signals become emotionally distracting",
        "clarity arrives slower than expected",
    ],
    clarity: [
        "something emotionally unclear starts making sense",
        "a delayed realization changes your perspective",
        "clarity appears gradually through the day",
    ],
    mood_shift: [
        "your mood may change faster than expected",
        "small moments strongly affect your emotional state",
        "the emotional tone of the day feels unstable",
    ],
    reflection: [
        "quiet moments feel more significant today",
        "certain memories may return unexpectedly",
        "you may rethink something you considered settled",
    ],
    love: [
        "affection feels easier to notice today",
        "small romantic moments feel amplified",
        "emotional closeness develops naturally",
    ],
    frustration: [
        "delays feel more irritating than usual",
        "motivation clashes with external limitations",
        "impatience grows through repeated interruptions",
    ],
    pressure: [
        "responsibilities may feel emotionally heavier today",
        "expectations become difficult to ignore",
        "you may feel mentally pulled in multiple directions",
    ],
    dreaminess: [
        "your attention drifts more easily today",
        "reality may feel slightly emotionally blurred",
        "you may become absorbed in imagination or memories",
    ],
};

export const MOON_SIGN_INFLUENCE: Record<ZodiacSign, string> = {
    aries: "Emotions become more immediate and direct. Acting on instinct may feel more natural than waiting.",

    taurus: "Comfort, stability and familiar surroundings become more important. Small pleasures can feel especially rewarding.",

    gemini: "Curiosity increases and conversations become more stimulating. New ideas are easier to explore than commit to.",

    cancer: "Emotional needs become more noticeable. Home, family and familiar people may feel especially important.",

    leo: "Confidence and self-expression come more naturally. Appreciation and genuine recognition can have a stronger impact than usual.",

    virgo: "Attention shifts toward details, routines and practical improvements. Small adjustments may feel surprisingly satisfying.",

    libra: "Harmony, balance and cooperation become more valuable. Relationships often benefit from patience and compromise.",

    scorpio:
        "Emotions become deeper and more private. Hidden motivations or unspoken feelings may be easier to recognize.",

    sagittarius:
        "Optimism grows and routine feels less appealing. New experiences, ideas or perspectives may become especially attractive.",

    capricorn:
        "Responsibility and long-term thinking naturally take priority. Steady progress feels more rewarding than quick results.",

    aquarius:
        "Independent thinking becomes stronger. Looking at situations from a different perspective may bring useful insights.",

    pisces: "Sensitivity and intuition become more noticeable. Subtle emotions and unspoken signals may be easier to recognize.",
};

export const MOON_PHASE_INFLUENCE: Record<string, string> = {
    "New Moon": "A good time for quiet beginnings, setting intentions and creating space for something new.",

    "Waxing Crescent": "Momentum is gradually building. Small actions today can create meaningful progress.",

    "First Quarter": "Today's energy favors decisions, action and overcoming small obstacles instead of waiting.",

    "Waxing Gibbous":
        "Progress comes through patience and refinement. Finishing details may be more rewarding than starting something new.",

    "Full Moon":
        "Feelings and situations become more visible. What has been developing beneath the surface may become easier to understand.",

    "Waning Gibbous": "Reflection and sharing become more valuable. Recent experiences can offer useful perspective.",

    "Last Quarter":
        "Letting go of unnecessary pressure creates room for better decisions. Adjustment is often more useful than persistence.",

    "Waning Crescent":
        "Slowing down, resting and reflecting may feel more natural than pushing forward. Give yourself space before the next beginning.",
};

export interface DominantPlanet {
    planet: Planet;
    score: number;
    profile: AstrologicalProfile;
}

export function getDominantPlanets(influences: ProfileInfluence[], limit = 5): DominantPlanet[] {
    return influences
        .filter((i): i is PlanetInfluence => i.type === "planet")
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((i) => ({
            planet: i.id as Planet,
            score: i.score,
            profile: i.profile,
        }));
}

export interface DominantAspect {
    aspect: AspectType;
    score: number;
    profile: AspectProfile;
    source?: TransitAspect;
}

export function getDominantAspects(influences: ProfileInfluence[], limit = 5): DominantAspect[] {
    return influences
        .filter((i): i is AspectInfluence => i.type === "aspect")
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((i) => ({
            aspect: i.id as AspectType,
            score: i.score,
            profile: i.profile,
            source: i.source,
        }));
}

/* ============================================================
   MAIN ANALYSIS
============================================================ */
export function analyzeTransits(transits: DailyTransits) {
    const influences = collectInfluences(transits);

    const context = buildInterpretationContext(influences);

    const dominantPlanet = context.dominantPlanets[0];

    const atmosphere = deriveAtmosphere({
        energy: context.energy,
        dominantPlanet,
    });

    const observations = generateObservations(context.themes);

    const moonPlacement = transits.planets.moon.sign;

    const moonPhase = getMoonPhase(transits.planets.sun.longitude, transits.planets.moon.longitude);

    const lunarInfluence = `${MOON_SIGN_INFLUENCE[moonPlacement]} ${MOON_PHASE_INFLUENCE[moonPhase]}`;

    return {
        context,

        moon: {
            sign: moonPlacement,
            phase: moonPhase,
            influence: lunarInfluence,
        },

        atmosphere,

        observations,
    };
}

/* ============================================================
   PROMPT BUILDER
============================================================ */

export function buildPrompt(input: {
    analysis: ReturnType<typeof analyzeTransits>;
    /** The whole scoring result: the prompt needs the reasons, not only the numbers. */
    score: DailyScoreResult;
    sunSign: string;
    moonSign: string;
    language: string;
    relationshipStatus?: string;
    priorities?: string[];
    /** Per-body weights from the engine. The model interprets them, never rescores them. */
    planets: PlanetWeight[];
}) {
    const { analysis, sunSign, moonSign, language, relationshipStatus, priorities } = input;

    const { themes, energy, dominantPlanets, dominantAspects, behavior, guidance, opportunities, challenges } =
        analysis.context;

    const dominantPlanet = dominantPlanets[0];

    const { loveScore, careerScore, healthScore, moodScore, overallScore } = input.score.scores;

    /**
     * Orb and strength are here so the model can tell an aspect 0.2° from exact apart
     * from one about to leave orb. Flattened to text they read identically, yet only
     * one of them is worth calling today's dominant influence.
     */
    const bodies = input.planets
        .map((planet) => {
            const profile = PLANET_PROFILES[planet.name];

            const contacts =
                planet.contacts.length > 0
                    ? planet.contacts
                          .map(
                              (contact) =>
                                  `  - id: ${contact.id} | ${contact.reason} | "${
                                      contact.title
                                  }" | orb ${contact.orb.toFixed(1)}°, exactness ${Math.round(
                                      contact.strength * 100
                                  )}%, ${contact.value >= 0 ? "supportive" : "difficult"}`
                          )
                          .join("\n")
                    : "  - none — this body makes no contact with the chart today";

            return `
${profile.displayName} (id: ${planet.name})
Weight today: ${planet.score}/100, from ${planet.aspects} aspect${planet.aspects === 1 ? "" : "s"}
Meaning: ${profile.description}
Keywords: ${profile.keywords.join(", ")}
Today's contacts:
${contacts}`;
        })
        .join("\n");

    /**
     * The specific transits behind today's numbers, ordered by narrative interest
     * rather than magnitude. This is what stops the horoscope from being generic:
     * these aspects are this user's, not the day's.
     */
    const personalTransits = input.score.breakdown.top
        .map(
            (impact) =>
                `- ${impact.reason} — ${impact.title} (${impact.area}, ${impact.value >= 0 ? "supportive" : "difficult"})`
        )
        .join("\n");

    return `
You are writing a premium daily horoscope for a modern astrology application.

Your task is to translate today's astrological influences into a believable, engaging and realistic description of the user's day.

The horoscope should never feel generic.

It should feel as though it was written specifically for today's unique astrological configuration.

==================================================
GOAL
==================================================

Write a horoscope that is:

- natural
- believable
- emotionally intelligent
- socially realistic
- conversational
- immersive
- observational
- easy to visualize

The reader should think:

"This genuinely sounds like the kind of day I could have."

Describe situations rather than abstract emotions.

Whenever possible, show emotions through actions, conversations, routines, choices and interactions.

==================================================
ASTROLOGY DRIVES THE STORY
==================================================

Everything in the horoscope must originate from the astrological interpretation.

Do not invent situations that contradict today's astrology.

The astrology should determine:

- today's atmosphere
- emotional tendencies
- communication style
- relationships
- work patterns
- decision making
- motivation
- opportunities
- challenges

Treat the astrological interpretation as the primary source of truth.

When multiple influences exist:

• identify recurring patterns

• strengthen ideas supported by multiple influences

• naturally blend conflicting influences

• create one coherent story

Do not attempt to use every astrological detail equally.

Favor consistency over completeness.

Use the following priority:

1. Dominant aspects

2. Dominant planet

3. Overall atmosphere

4. Moon sign

5. Moon phase

6. Dominant themes

7. Energy profile

8. Behavior tendencies

9. Guidance

10. Opportunities

11. Challenges

12. Life scores

==================================================
EVERY DAY SHOULD FEEL DIFFERENT
==================================================

Imagine someone reading this horoscope every day.

Each day should feel unique.

Rotate naturally between:

- work

- productivity

- creativity

- money

- family

- romance

- friendships

- routines

- health

- travel

- learning

- hobbies

- confidence

- planning

- organization

- home life

- unexpected events

Different astrology should naturally create different kinds of days.

A Venus day should not resemble a Saturn day.

A Mars day should not resemble a Neptune day.

A Full Moon should not resemble a Waning Crescent.

The astrology should shape the narrative itself, not only the mood.

==================================================
WRITING STYLE
==================================================

Write like an excellent lifestyle columnist.

The writing should feel:

- modern

- human

- confident

- grounded

- emotionally believable

- relatable

Prefer:

- realistic situations

- everyday observations

- practical consequences

- believable dialogue

- subtle emotional realism

Show rather than explain.

Instead of saying:

"You feel uncertain."

Describe why.

Example:

"You may realize that two different people expect different things from you."

Instead of:

"You become more confident."

Describe the event that naturally creates confidence.

Avoid:

- mystical language

- spiritual language

- therapy language

- motivational language

- philosophy

- literary metaphors

- clichés

- exaggerated drama

==================================================
ASTROLOGICAL STATE
==================================================

The following interpretation represents today's complete astrological picture.

Treat it as the primary source of truth.

Never mention astrology directly.

Instead, translate these influences into believable everyday experiences.

Do not describe every section independently.

Combine them into one coherent narrative.

Favor the strongest recurring influences.

--------------------------------------------------
MOON
--------------------------------------------------

Moon sign:
${analysis.moon.sign}

Moon phase:
${analysis.moon.phase}

Lunar influence:
${analysis.moon.influence}

--------------------------------------------------
OVERALL ATMOSPHERE
--------------------------------------------------

Dominant energy:
${analysis.atmosphere.dominantEnergy}

Planetary atmosphere:
${analysis.atmosphere.planetaryAtmosphere}

Emotional tone:
${analysis.atmosphere.emotionalTone}

--------------------------------------------------
DOMINANT PLANET
--------------------------------------------------

Planet:
${dominantPlanet.profile.displayName}

Meaning:
${dominantPlanet.profile.description}

Themes:
${dominantPlanet.profile.themes.join(", ")}

Keywords:
${dominantPlanet.profile.keywords.join(", ")}

Behavior

Communication:
${dominantPlanet.profile.expression.communication.join(", ")}

Relationships:
${dominantPlanet.profile.expression.relationships.join(", ")}

Work:
${dominantPlanet.profile.expression.work.join(", ")}

Wellbeing:
${dominantPlanet.profile.expression.wellbeing.join(", ")}

Guidance

Embrace:
${dominantPlanet.profile.guidance.embrace.join(", ")}

Avoid:
${dominantPlanet.profile.guidance.avoid.join(", ")}

Opportunities:
${dominantPlanet.profile.opportunities.join(", ")}

Challenges:
${dominantPlanet.profile.challenges.join(", ")}

--------------------------------------------------
DOMINANT ASPECTS
--------------------------------------------------

${dominantAspects
    .slice(0, 3)
    .map(
        (aspect, index) => `
Aspect ${index + 1}

${aspect.profile.displayName}

Meaning:
${aspect.profile.description}

Themes:
${aspect.profile.themes.join(", ")}

Dynamics

Communication:
${aspect.profile.dynamics.communication.join(", ")}

Relationships:
${aspect.profile.dynamics.relationships.join(", ")}

Work:
${aspect.profile.dynamics.work.join(", ")}

Wellbeing:
${aspect.profile.dynamics.wellbeing.join(", ")}

Guidance

Embrace:
${aspect.profile.guidance.embrace.join(", ")}

Avoid:
${aspect.profile.guidance.avoid.join(", ")}

Opportunities:
${aspect.profile.opportunities.join(", ")}

Challenges:
${aspect.profile.challenges.join(", ")}
`
    )
    .join("\n")}

--------------------------------------------------
DOMINANT THEMES
--------------------------------------------------

${themes
    .slice(0, 8)
    .map((theme) => `${theme.theme}: ${Math.round(theme.score)}`)
    .join("\n")}

--------------------------------------------------
ENERGY PROFILE
--------------------------------------------------

Activity:
${energy.activity}

Emotion:
${energy.emotion}

Intellect:
${energy.intellect}

Spirituality:
${energy.spirituality}

Interpret the strongest dimensions as today's dominant style of behavior.

--------------------------------------------------
BEHAVIOR TENDENCIES
--------------------------------------------------

These describe how today's astrology naturally expresses itself.

Communication

${behavior.communication.join(", ")}

Relationships

${behavior.relationships.join(", ")}

Work

${behavior.work.join(", ")}

Wellbeing

${behavior.wellbeing.join(", ")}

--------------------------------------------------
PRACTICAL GUIDANCE
--------------------------------------------------

Today's astrology especially supports:

${guidance.embrace.join(", ")}

Today's astrology advises caution with:

${guidance.avoid.join(", ")}

--------------------------------------------------
LIKELY OPPORTUNITIES
--------------------------------------------------

${opportunities.join("\n")}

--------------------------------------------------
LIKELY CHALLENGES
--------------------------------------------------

${challenges.join("\n")}

--------------------------------------------------
EXAMPLE EVERYDAY SITUATIONS
--------------------------------------------------

These are examples of situations that naturally fit today's astrology.

Use them as inspiration.

Do not copy them literally.

${analysis.observations.join("\n")}

--------------------------------------------------
THIS PERSON'S TRANSITS TODAY
--------------------------------------------------

These are aspects between today's sky and THIS person's birth chart. They are the
reason their scores differ from anyone else's today, and they are what the
horoscope should actually be about.

Ground the concrete situations you describe in these, strongest first.

${personalTransits}

--------------------------------------------------
LIFE AREA SCORES
--------------------------------------------------

These scores describe where today's astrology is strongest.

Higher scores should naturally produce smoother experiences.

Lower scores should create believable friction.

Love:
${loveScore}/100

Career:
${careerScore}/100

Health:
${healthScore}/100

Mood:
${moodScore}/100

Overall:
${overallScore}/100

==================================================
USER CONTEXT
==================================================

Sun sign:

${sunSign}

Moon sign:

${moonSign}

Relationship status:

${relationshipStatus ?? "unknown"}

Priorities:

${priorities?.join(", ") ?? "none"}

Do not mention the user's Sun sign, Moon sign or relationship status directly.

If the user's priorities naturally align with today's astrology, gently incorporate them.

Never force them into the narrative.

==================================================
TODAY'S PLANETS
==================================================

Besides the horoscope you also write one interpretation per planetary body, for the
panel the reader opens from the horoscope. Same day, same voice, same context — which
is why it is written here rather than in a request of its own.

Each body carries a score from 0–100 describing how active it is TODAY in this chart.
The score measures importance, not positivity. A high score means strong influence,
not a good day. A score near zero means the body is largely inactive today.

Never mention the score. Never mention numbers.

Every contact carries an orb and an exactness percentage. Exactness describes how
precisely the contact lands today:

High exactness (roughly 80–100%) means the influence is at its peak right now. Write
about it as something clearly present today.

Medium exactness (roughly 40–80%) means it is building or fading. Write about it as a
background influence rather than the main event.

Low exactness (below roughly 40%) means it is barely in effect. Mention it only if
nothing else is happening for that body.

When one body has several contacts, let the most exact one lead the description, and
use the others only where they genuinely change the picture. Never state the orb or
the percentage — translate them into how present the influence feels.

Each contact is listed as:

  id | English label | "English title" | orb, exactness, direction

${bodies}

==================================================
OUTPUT
==================================================

Return ONLY valid JSON.

{
    "overview": {
        "title": "string",
        "description": "string"
    },
    "moon": {
        "phase": "string",
        "insight": "string",
        "reason": "string"
    },
    "insights": {
        "love": {
            "score": number,
            "insight": "string",
            "reason": "string"
        },
        "career": {
            "score": number,
            "insight": "string",
            "reason": "string"
        },
        "health": {
            "score": number,
            "insight": "string",
            "reason": "string"
        },
        "mood": {
            "score": number,
            "insight": "string",
            "reason": "string"
        },
        "overall": {
            "score": number,
            "insight": "string",
            "reason": "string"
        }
    },
    "opportunity": {
        "description": "string",
        "examples": [
            "string",
            "string",
            "string",
            "string"
        ]
    },
    "watchOut": {
        "description": "string",
        "examples": [
            "string",
            "string",
            "string",
            "string"
        ]
    },
    "deepInsight": "string",
    "planets": [
        {
            "name": "sun",
            "description": "string",
            "reason": "string",
            "contacts": [
                {
                    "id": "string",
                    "title": "string"
                }
            ]
        }
    ]
}

Field requirements:

- overview.title:
  Short, memorable headline (max 30-40 characters).

- overview.description:
  One concise summary of today's overall energy (max 180 characters).

- moon.phase:
  Current Moon phase (e.g. "Waxing Gibbous").

- moon.insight:
  Explain how today's Moon placement may be experienced (max 150 characters).

- moon.reason:
  Explain WHY today's Moon sign and phase create this influence (max 150 characters).

- insights.*.score:
  Integer between 0 and 100.

- insights.*.insight:
  A practical, specific insight for that life area (max 150 characters).

- insights.*.reason:
  Explain the astrological reason behind the insight (max 150 characters).

- opportunity.description:
  One practical opportunity, activity or recommendation for today (max 150 characters).

- opportunity.examples:
  Array of exactly 4 short words or phrases representing today's recommended activities or themes.
  Examples:
  ["Networking", "Exercise", "Creative work", "Reading"]

- watchOut.description:
  One practical warning about what to avoid today (max 150 characters).

- watchOut.examples:
  Array of exactly 4 short words or phrases representing things to avoid today.
  Examples:
  ["Arguments", "Overspending", "Procrastination", "Impulsive decisions"]

- deepInsight:
  A detailed horoscope with multiple paragraphs explaining today's astrological influences, practical implications and guidance.

- planets:
  Exactly one object for every planet listed under TODAY'S PLANETS, in the same order.
  Use the exact id as "name". Never return the score, the orb or the exactness.
  Never invent contacts: return exactly the ones listed for that body, in the same
  order, and copy each "id" character for character. A body with no contacts gets an
  empty "contacts" array.

- planets[].description:
  Exactly 3 paragraphs separated by a blank line, 600–1000 characters in total, about
  TODAY only. First what the influence does in everyday life, then why it is stronger
  or weaker than usual. Never name aspects, signs or astrological jargon here.

- planets[].reason:
  Exactly 2 paragraphs separated by a blank line, 350–650 characters in total. Explain
  the mechanism behind today's influence in plain, everyday language.

- planets[].contacts[].title:
  Translate the English title. It is a caption shown next to the numbers, not prose:
  a short headline, never longer than the original and never a sentence.

Do not return markdown.

Do not wrap the JSON inside code fences.

Do not explain anything.

Return only the JSON object.

==================================================
HOROSCOPE
==================================================

Write a horoscope consisting of 6–8 sentences.

Split it into 2–3 short paragraphs.

Separate paragraphs with one blank line.

The horoscope should read like a believable story about today's experiences.

It should feel personal without pretending to know facts about the user's life.

Describe situations that many people genuinely experience.

The situations should become unique because of today's astrology.

--------------------------------------------------
BUILD THE DAY
--------------------------------------------------

Beginning

Introduce today's atmosphere.

Allow the reader to immediately recognize the type of day.

Middle

Describe one or two realistic situations.

These situations should naturally emerge from today's dominant themes, behavior tendencies, opportunities and challenges.

Ending

Finish with a believable outcome, practical realization or quiet opportunity.

Avoid dramatic endings.

Avoid artificial optimism.

--------------------------------------------------
SHOW, DON'T EXPLAIN
--------------------------------------------------

Always describe situations before emotions.

Instead of:

"You feel uncertain."

Describe the situation that creates uncertainty.

Instead of:

"You become more confident."

Describe the event that naturally builds confidence.

Instead of:

"You feel stressed."

Describe the responsibilities, conversations or events that realistically create pressure.

Whenever possible:

Actions → create emotions.

Not:

Emotions → create actions.

==================================================
REALISTIC EVERYDAY MOMENTS
==================================================

Prefer situations such as:

• finishing postponed work

• reorganizing plans

• receiving unexpected appreciation

• waiting for a message

• clearing up a misunderstanding

• making practical decisions

• helping someone

• unexpected invitations

• solving everyday problems

• improving routines

• family responsibilities

• financial choices

• learning something useful

• rediscovering an old idea

The situations should feel ordinary but memorable.

==================================================
NARRATIVE DIVERSITY
==================================================

Avoid repeatedly creating horoscopes about:

• overthinking

• hidden meanings

• reading between the lines

• emotional sensitivity

• misunderstanding conversations

• analyzing relationships

• emotional processing

These themes should appear only when today's astrology strongly supports them.

Different astrology should naturally create different kinds of days.

Examples:

• productive

• practical

• social

• romantic

• adventurous

• energetic

• reflective

• disciplined

• playful

• organized

• spontaneous

The astrology should determine which kind of day today's horoscope becomes.

==================================================
WRITING QUALITY
==================================================

Write like an experienced journalist or lifestyle columnist.

Not like:

• an astrologer

• a therapist

• a philosopher

• a motivational speaker

Avoid:

• clichés

• vague encouragement

• generic self-help

• spiritual language

• mystical wording

• therapy terminology

• literary metaphors

• exaggerated emotions

Vary sentence openings.

Vary sentence lengths.

Some sentences may be short.

Some may be more descriptive.

Avoid repeatedly beginning sentences with:

"You may..."

"You might..."

"Today..."

"It may..."

The writing should feel naturally human.

==================================================
MOON INSIGHT
==================================================

Write one short insight inspired by today's Moon sign and Moon phase.

Length:

1–2 sentences.

Maximum 25 words.

Purpose:

Highlight one subtle emotional tendency that could naturally become noticeable today.

The insight should:

• feel practical

• feel relatable

• sound contemporary

• complement the horoscope

Do not:

• predict specific events

• mention astrology

• mention planets

• mention zodiac signs

• use mystical language

==================================================
OPPORTUNITY
==================================================

Write one practical opportunity or recommendation for today.

Base it on:

• today's opportunities
• today's guidance
• dominant themes

Maximum 150 characters.

Describe one realistic activity or direction that is especially supported today.

Generate exactly four activities.

Each activity must be 1–3 words.

Choose practical activities, situations or themes.

Examples:

Networking
Creative work
Exercise
Financial planning
Learning
Nature
Deep conversations
Family time

Do not repeat the same idea from the description.

==================================================
WATCH OUT
==================================================

Write one practical warning for today.

Base it on:

• today's challenges
• today's guidance
• dominant aspects
• lower life scores

Maximum 150 characters.

Describe one realistic behavior or situation worth avoiding today.

Generate exactly four avoid items.

Each item must be 1–3 words.

Examples:

Arguments
Overspending
Impulsive decisions
Procrastination
Distractions
Overthinking
Conflict
Risk-taking

Do not repeat the same idea from the description.

==================================================
SCORES
==================================================

Return exactly the provided scores.

Do not invent new values.

Love:
${loveScore}

Career:
${careerScore}

Health:
${healthScore}

Mood:
${moodScore}

Overall:
${overallScore}

The horoscope should naturally reflect these values.

Higher scores should create more opportunities.

Lower scores should create more realistic obstacles.

Do not make every area equally positive.

==================================================
CONSISTENCY
==================================================

Every generated field should support the same overall narrative.

The horoscope, Moon Insight, Focus, Caution, Do and Avoid should all describe the same kind of day.

Avoid contradictions.

Avoid introducing ideas unsupported by today's astrological interpretation.

If one influence is clearly dominant, allow it to shape every generated field.

Focus areas should naturally emerge from the horoscope.

Cautions should naturally emerge from the challenges.

The "Do" recommendation should reflect today's opportunities.

The "Avoid" recommendation should reflect today's challenges.

==================================================
FINAL QUALITY CHECK
==================================================

Before returning the JSON, silently verify that:

• the horoscope clearly reflects today's astrological interpretation

• the dominant planet and dominant aspects noticeably influence the narrative

• the Moon influences the emotional atmosphere

• behavior tendencies shape how people interact

• opportunities appear naturally

• challenges create believable friction

• life scores influence which areas receive attention

• emotions are shown through situations instead of abstract statements

• at least one concrete everyday situation appears

• the horoscope could not reasonably fit a different astrological day

• the writing feels natural and contemporary

• no sentence sounds like generic self-help

• no sentence sounds mystical or spiritual

• no astrology is mentioned directly

• the ending feels calm, believable and satisfying

• activity and avoid items must be concise (1–3 words each).

• use practical everyday activities, situations or themes.

• do not repeat the same recommendation in both the description and the list.

• prefer specific and actionable suggestions over generic advice.

If the horoscope feels generic, rewrite it.

If several different astrological influences repeat the same idea, strengthen that idea.

If different influences conflict, create a believable balance instead of ignoring either one.

The reader should immediately feel that today's horoscope is unique.

Respond only in:
${language}.
`;
}

/* ============================================================
   GENERATE DAILY INSIGHT
============================================================ */

export interface DailyScores {
    loveScore: number;
    careerScore: number;
    healthScore: number;
    moodScore: number;
    overallScore: number;
}

export interface DailyInsightContent {
    overview: {
        title: string;
        description: string;
    };
    deepInsight: string[];
    moon: {
        insight: string;
        reason: string;
    };
    opportunity: {
        description: string;
        examples: string[];
    };
    watchOut: {
        description: string;
        examples: string[];
    };
    insights: Record<
        "love" | "career" | "health" | "mood" | "overall",
        {
            insight: string;
            reason: string;
        }
    >;
    planets: {
        name: Planet;
        description: string;
        reason: string;
        contacts: Record<
            string,
            {
                id: string;
                title: string;
            }
        >;
    }[];
}

export type GenerationStatus = "absent" | "pending" | "ready" | "failed";

export interface DailyInsight {
    overview: {
        title: string;
        description: string;
    };
    moon: {
        phase: string;
        insight: string;
        reason: string;
    };
    insights: {
        love: {
            score: number;
            insight: string;
            reason: string;
        };
        career: {
            score: number;
            insight: string;
            reason: string;
        };
        health: {
            score: number;
            insight: string;
            reason: string;
        };
        mood: {
            score: number;
            insight: string;
            reason: string;
        };
        overall: {
            score: number;
            insight: string;
            reason: string;
        };
    };
    opportunity: {
        description: string;
        examples: string[];
    };
    watchOut: {
        description: string;
        examples: string[];
    };
    deepInsight: string;
    debug?: any;
}

/**
 * One contact's text, in the user's language.
 *
 * Only the wording is stored. Orb, exactness and direction are recomputed from the
 * charts on every read and joined back on by `id`, so the numbers can never drift
 * away from the engine that produced them.
 */
export interface DailyContactText {
    /** "saturn_square_moon" — the engine's key, echoed by the model. */
    id: string;
    /** "Tranzitní Saturn v kvadratuře k natálnímu Měsíci" */
    label: string;
    /** "Emocionální tíha" */
    title: string;
}

/**
 * A body's weight for the day, with the LLM's interpretation of it.
 *
 * `score`, `weight` and `aspects` come from the engine and are never touched by the
 * model; `description`, `reason` and the contact wording are generated.
 */
export interface DailyPlanetInsight {
    name: AstroPlanet;
    score: number;
    weight: number;
    aspects: number;
    description: string;
    reason: string;
    /** Absent on rows written before contacts were translated. */
    contacts?: DailyContactText[];
}

const MODEL = "gemini-2.5-flash";

const wordingSchema = z.object({
    insight: z.string(),
    reason: z.string(),
});

/**
 * What the model is asked to return — not what gets stored. The engine's numbers are
 * copied back in afterwards and `deepInsight` is split into paragraphs, so this mirrors
 * the OUTPUT block of the prompt rather than `DailyInsightContent`.
 *
 * Handed to the decoder as a response schema, so a malformed answer stops being
 * possible instead of being caught after the fact.
 */
const answerSchema = z.object({
    overview: z.object({ title: z.string(), description: z.string() }),
    moon: z.object({ phase: z.string(), insight: z.string(), reason: z.string() }),
    insights: z.object({
        love: wordingSchema,
        career: wordingSchema,
        health: wordingSchema,
        mood: wordingSchema,
        overall: wordingSchema,
    }),
    opportunity: z.object({ description: z.string(), examples: z.array(z.string()) }),
    watchOut: z.object({ description: z.string(), examples: z.array(z.string()) }),
    deepInsight: z.string(),
    planets: z.array(
        z.object({
            name: z.enum(PLANETS),
            description: z.string(),
            reason: z.string(),
            contacts: z.array(z.object({ id: z.string(), title: z.string() })),
        })
    ),
});

/** List price per million tokens, so the logged cost is what was actually charged. */
const PRICE_PER_MILLION = { input: 0.3, output: 2.5 };

/**
 * One request writes the horoscope and the planetary panel together: they describe the
 * same day from the same context, and a second request would pay twice for that
 * context. Never throws on a bad answer — the caller logs every call, successful or
 * not, so a parse failure has to come back with its metrics attached.
 */
export async function generateDailyInsight(input: {
    transits: DailyTransits;
    /**
     * Already-computed scores. This module writes text and does not score anything:
     * the numbers come from modules/dailyScore, which is deterministic and tested.
     */
    score: DailyScoreResult;
    planets: PlanetWeight[];
    sunSign: string;
    moonSign: string;
    languageIso: string;
    relationshipStatus?: string;
    priorities?: string[];
    goals?: string[];
}): Promise<{
    content: DailyInsightContent | null;
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
        /** Set when the model answered but the answer was unusable. */
        error: string | null;
    };
}> {
    const analysis = analyzeTransits(input.transits);

    const language = getLanguageByIso(input.languageIso);

    const prompt = buildPrompt({
        analysis,
        score: input.score,
        planets: input.planets,
        sunSign: input.sunSign,
        moonSign: input.moonSign,
        relationshipStatus: input.relationshipStatus,
        priorities: input.priorities,
        language: language ? buildPromptLanguageRule(language) : input.languageIso,
    });

    const startedAt = Date.now();

    const response = await ai.models.generateContent({
        model: MODEL,
        contents: prompt,
        config: {
            responseMimeType: "application/json",
            responseJsonSchema: toResponseJsonSchema(answerSchema),
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
    const parsed = raw === null ? null : answerSchema.safeParse(raw);

    if (!parsed?.success) {
        /**
         * The merged prompt returns a large object, so the usual cause is a truncated
         * answer — but not always, and `finishReason` alone cannot tell those apart:
         * `STOP` means the model finished and the fault is on this side of the wire.
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
                output: getLLMJson(text),
                error: `${reason} (finishReason: ${response.candidates?.[0]?.finishReason ?? "unknown"}, ${text.length} chars)`,
            },
        };
    }

    const result = parsed.data;

    return {
        usage: { ...usage, output: getLLMJson(text) },
        content: {
            overview: result.overview,
            // Paragraphs are split here so no screen has to parse "\n".
            deepInsight: result.deepInsight
                .split(/\n\s*\n/u)
                .map((paragraph) => paragraph.trim())
                .filter(Boolean),
            moon: { insight: result.moon.insight, reason: result.moon.reason },
            opportunity: result.opportunity,
            watchOut: result.watchOut,
            insights: {
                love: { insight: result.insights.love.insight, reason: result.insights.love.reason },
                career: { insight: result.insights.career.insight, reason: result.insights.career.reason },
                health: { insight: result.insights.health.insight, reason: result.insights.health.reason },
                mood: { insight: result.insights.mood.insight, reason: result.insights.mood.reason },
                overall: { insight: result.insights.overall.insight, reason: result.insights.overall.reason },
            },
            /**
             * Driven by the engine's list, not the model's: a body or contact the model
             * dropped, duplicated or renamed still gets an entry, falling back to the
             * English wording rather than disappearing from the panel.
             */
            planets: input.planets.map((planet) => {
                const written = result.planets?.find((entry) => entry.name === planet.name);

                return {
                    name: planet.name,
                    description: written?.description ?? PLANET_PROFILES[planet.name].description,
                    reason: written?.reason ?? planet.contacts.map((contact) => contact.reason).join(", "),
                    contacts: Object.fromEntries(
                        planet.contacts.map((contact) => [
                            contact.id,
                            {
                                id: contact.id,
                                title:
                                    written?.contacts?.find((entry) => entry.id === contact.id)?.title ?? contact.title,
                            },
                        ])
                    ),
                };
            }),
        },
    };
}

export interface AstrologicalProfile {
    /**
     * Interní identifikátor.
     */
    id: string;

    /**
     * Název pro AI i UI.
     */
    displayName: string;
    /**
     * Krátký astrologický význam.
     */
    description: string;
    /**
     * Hlavní astrologická témata.
     */
    themes: Theme[];
    /**
     * Jakou energii přináší.
     */
    energy: {
        activity: number;
        emotion: number;
        intellect: number;
        spirituality: number;
    };
    /**
     * Typický způsob projevu.
     */
    expression: {
        communication: string[];
        relationships: string[];
        work: string[];
        wellbeing: string[];
    };
    /**
     * Co energie podporuje.
     */
    opportunities: string[];
    /**
     * Na co si dát pozor.
     */
    challenges: string[];
    /**
     * Praktická doporučení.
     */
    guidance: {
        embrace: string[];
        avoid: string[];
    };
    /**
     * Jednoslovné pojmy vhodné pro AI.
     */
    keywords: string[];
}

export interface SignProfile {
    id: ZodiacSign;

    displayName: string;

    description: string;

    themes: Theme[];

    modifiers: {
        activity: number;

        emotion: number;

        intellect: number;

        spirituality: number;
    };

    expression: {
        communication: string[];

        relationships: string[];

        work: string[];

        wellbeing: string[];
    };

    strengths: string[];

    challenges: string[];

    keywords: string[];
}

export interface AspectProfile {
    id: AspectType;

    displayName: string;

    description: string;

    interaction: {
        harmony: number;
        intensity: number;
        friction: number;
        growth: number;
    };

    themes: Theme[];

    dynamics: {
        communication: string[];
        relationships: string[];
        work: string[];
        wellbeing: string[];
    };

    opportunities: string[];

    challenges: string[];

    guidance: {
        embrace: string[];
        avoid: string[];
    };

    keywords: string[];
}

export type ProfileType = "planet" | "sign" | "aspect";

export interface PlanetInfluence {
    type: "planet";
    id: string;
    score: number;
    profile: AstrologicalProfile;
    source?: TransitPlanet;
}

export interface SignInfluence {
    type: "sign";
    id: string;
    score: number;
    profile: SignProfile;
    source?: TransitPlanet;
}

export interface AspectInfluence {
    type: "aspect";
    id: string;
    score: number;
    profile: AspectProfile;
    source?: TransitAspect;
}

export type ProfileInfluence = PlanetInfluence | SignInfluence | AspectInfluence;

export function isPlanetInfluence(influence: ProfileInfluence): influence is ProfileInfluence & {
    profile: AstrologicalProfile;
} {
    return influence.type === "planet";
}

export function isSignInfluence(influence: ProfileInfluence): influence is ProfileInfluence & {
    profile: SignProfile;
} {
    return influence.type === "sign";
}

export function isAspectInfluence(influence: ProfileInfluence): influence is ProfileInfluence & {
    profile: AspectProfile;
} {
    return influence.type === "aspect";
}

export const PLANET_WEIGHTS: Record<Planet, number> = {
    sun: 1.3,
    moon: 1.25,
    mercury: 1.0,
    venus: 1.05,
    mars: 1.1,
    jupiter: 0.95,
    saturn: 0.95,
    uranus: 0.75,
    neptune: 0.75,
    pluto: 0.75,
};

export function collectInfluences(transits: DailyTransits): ProfileInfluence[] {
    const influences: ProfileInfluence[] = [];

    // planets

    for (const planet of Object.keys(transits.planets) as Planet[]) {
        influences.push({
            type: "planet",
            id: planet,
            score: PLANET_WEIGHTS[planet],
            profile: PLANET_PROFILES[planet],
            source: transits.planets[planet],
        });
    }

    // signs

    for (const [planetName, planet] of Object.entries(transits.planets) as [Planet, TransitPlanet][]) {
        influences.push({
            type: "sign",
            id: planet.sign,
            score: PLANET_WEIGHTS[planetName] * 0.8,
            profile: SIGN_PROFILES[planet.sign],
            source: planet,
        });
    }

    // aspects

    for (const aspect of transits.aspects) {
        const [planet1, planet2] = aspect.planets;

        const planetWeight = (PLANET_WEIGHTS[planet1] + PLANET_WEIGHTS[planet2]) / 2;

        // Weighting for text selection only — these influences pick themes and
        // dominant aspects for the prompt and never reach a score. Reuses the
        // scoring module's constants so aspect strength is defined in one place.
        influences.push({
            type: "aspect",
            id: aspect.type,
            score: ASPECT_STRENGTH[aspect.type] * orbStrength(aspect.orb, MAX_ORBS[aspect.type]) * planetWeight,
            profile: ASPECT_PROFILES[aspect.type],
            source: aspect,
        });
    }

    return influences;
}

export interface InterpretationContext {
    themes: ThemeScore[];
    energy: EnergyProfile;
    dominantPlanets: DominantPlanet[];
    dominantAspects: DominantAspect[];
    behavior: BehaviorContext;
    guidance: GuidanceContext;
    opportunities: string[];
    challenges: string[];
}

export interface GuidanceContext {
    embrace: string[];
    avoid: string[];
}
export interface BehaviorContext {
    communication: string[];
    relationships: string[];
    work: string[];
    wellbeing: string[];
}

export function aggregateBehavior(influences: ProfileInfluence[]): BehaviorContext {
    const communication = new Set<string>();
    const relationships = new Set<string>();
    const work = new Set<string>();
    const wellbeing = new Set<string>();

    for (const influence of influences) {
        switch (influence.type) {
            case "planet":
            case "sign":
                influence.profile.expression.communication.forEach((x) => communication.add(x));
                influence.profile.expression.relationships.forEach((x) => relationships.add(x));
                influence.profile.expression.work.forEach((x) => work.add(x));
                influence.profile.expression.wellbeing.forEach((x) => wellbeing.add(x));

                break;

            case "aspect":
                influence.profile.dynamics.communication.forEach((x) => communication.add(x));
                influence.profile.dynamics.relationships.forEach((x) => relationships.add(x));
                influence.profile.dynamics.work.forEach((x) => work.add(x));
                influence.profile.dynamics.wellbeing.forEach((x) => wellbeing.add(x));

                break;
        }
    }

    return {
        communication: [...communication],
        relationships: [...relationships],
        work: [...work],
        wellbeing: [...wellbeing],
    };
}

export function buildInterpretationContext(influences: ProfileInfluence[]): InterpretationContext {
    return {
        themes: scoreThemes(influences),
        energy: aggregateEnergy(influences),
        dominantPlanets: getDominantPlanets(influences),
        dominantAspects: getDominantAspects(influences),
        behavior: aggregateBehavior(influences),
        guidance: aggregateGuidance(influences),
        opportunities: aggregateOpportunities(influences),
        challenges: aggregateChallenges(influences),
    };
}

export function aggregateChallenges(influences: ProfileInfluence[]): string[] {
    const challenges = new Set<string>();

    for (const influence of influences) {
        influence.profile.challenges.forEach((x) => challenges.add(x));
    }

    return [...challenges];
}

export function aggregateOpportunities(influences: ProfileInfluence[]): string[] {
    const opportunities = new Set<string>();

    for (const influence of influences) {
        switch (influence.type) {
            case "planet":
                influence.profile.opportunities.forEach((x) => opportunities.add(x));
                break;

            case "aspect":
                influence.profile.opportunities.forEach((x) => opportunities.add(x));
                break;
        }
    }

    return [...opportunities];
}

export function aggregateGuidance(influences: ProfileInfluence[]): GuidanceContext {
    const embrace = new Set<string>();
    const avoid = new Set<string>();

    for (const influence of influences) {
        switch (influence.type) {
            case "planet":
                influence.profile.guidance.embrace.forEach((x) => embrace.add(x));
                influence.profile.guidance.avoid.forEach((x) => avoid.add(x));
                break;

            case "aspect":
                influence.profile.guidance.embrace.forEach((x) => embrace.add(x));
                influence.profile.guidance.avoid.forEach((x) => avoid.add(x));
                break;
        }
    }

    return {
        embrace: [...embrace],
        avoid: [...avoid],
    };
}
