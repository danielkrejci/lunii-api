import { ai } from "../lib/ai";
import { ZodiacSign } from "../utils/natalUtils";
import { parseLLMJson } from "../utils/stringUtils";
import { getMoonPhase } from "./transits";

// ============================================================
// ADVANCED ASTRO ENGINE
// FULL VERSION
// ============================================================

/* ============================================================
   TYPES
============================================================ */

export type Planet =
    | "sun"
    | "moon"
    | "mercury"
    | "venus"
    | "mars"
    | "jupiter"
    | "saturn"
    | "uranus"
    | "neptune"
    | "pluto";

export type AspectType = "conjunction" | "opposition" | "square" | "trine" | "sextile";

export type ThemeCategory =
    | "emotional"
    | "social"
    | "mental"
    | "romantic"
    | "energetic"
    | "reflective"
    | "transformational";

export type ThemePolarity = "light" | "shadow" | "neutral";

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
   THEME META
============================================================ */

export interface ThemeDefinition {
    category: ThemeCategory;
    polarity: ThemePolarity;
    intensity?: number;
}

export const THEME_META: Record<Theme, ThemeDefinition> = {
    confidence: { category: "energetic", polarity: "light", intensity: 1.2 },
    visibility: { category: "social", polarity: "light" },
    self_expression: { category: "social", polarity: "light" },
    clarity: { category: "mental", polarity: "light" },
    identity: { category: "reflective", polarity: "neutral" },
    motivation: { category: "energetic", polarity: "light", intensity: 1.2 },
    recognition: { category: "social", polarity: "light" },

    emotion: { category: "emotional", polarity: "neutral" },
    sensitivity: { category: "emotional", polarity: "neutral" },
    reflection: { category: "reflective", polarity: "neutral" },
    comfort: { category: "emotional", polarity: "light" },
    nostalgia: { category: "reflective", polarity: "neutral" },
    intuition: { category: "reflective", polarity: "light" },
    mood_shift: { category: "emotional", polarity: "neutral" },
    emotional_need: { category: "emotional", polarity: "neutral" },

    communication: { category: "social", polarity: "light" },
    curiosity: { category: "mental", polarity: "light" },
    mental_clarity: { category: "mental", polarity: "light" },
    overthinking: { category: "mental", polarity: "shadow" },
    analysis: { category: "mental", polarity: "neutral" },
    conversation: { category: "social", polarity: "light" },
    misunderstanding: { category: "social", polarity: "shadow" },
    adaptability: { category: "social", polarity: "neutral" },

    love: { category: "romantic", polarity: "light" },
    connection: { category: "romantic", polarity: "light" },
    attraction: { category: "romantic", polarity: "light" },
    warmth: { category: "romantic", polarity: "light" },
    romance: { category: "romantic", polarity: "light" },
    beauty: { category: "romantic", polarity: "light" },
    affection: { category: "romantic", polarity: "light" },
    social_ease: { category: "social", polarity: "light" },

    restlessness: { category: "energetic", polarity: "shadow" },
    frustration: { category: "energetic", polarity: "shadow", intensity: 1.3 },
    impulsiveness: { category: "energetic", polarity: "shadow" },
    desire_for_progress: { category: "energetic", polarity: "light" },
    conflict: { category: "social", polarity: "shadow", intensity: 1.3 },
    energy: { category: "energetic", polarity: "light", intensity: 1.3 },
    impatience: { category: "energetic", polarity: "shadow" },
    assertiveness: { category: "energetic", polarity: "neutral" },

    optimism: { category: "energetic", polarity: "light" },
    growth: { category: "transformational", polarity: "light" },
    possibility: { category: "transformational", polarity: "light" },
    exploration: { category: "transformational", polarity: "light" },
    freedom: { category: "transformational", polarity: "light" },
    hope: { category: "emotional", polarity: "light" },
    openness: { category: "social", polarity: "light" },

    discipline: { category: "energetic", polarity: "neutral" },
    pressure: { category: "energetic", polarity: "shadow" },
    responsibility: { category: "reflective", polarity: "neutral" },
    restraint: { category: "energetic", polarity: "shadow" },
    seriousness: { category: "reflective", polarity: "neutral" },
    fatigue: { category: "emotional", polarity: "shadow" },
    patience: { category: "reflective", polarity: "light" },
    stability: { category: "reflective", polarity: "light" },

    change: { category: "transformational", polarity: "neutral" },
    surprise: { category: "transformational", polarity: "neutral" },
    rebellion: { category: "transformational", polarity: "shadow" },
    instability: { category: "transformational", polarity: "shadow" },
    breakthrough: { category: "transformational", polarity: "light" },
    independence: { category: "transformational", polarity: "light" },
    unpredictability: { category: "transformational", polarity: "shadow" },

    dreaminess: { category: "emotional", polarity: "neutral" },
    confusion: { category: "mental", polarity: "shadow" },
    idealism: { category: "reflective", polarity: "light" },
    fantasy: { category: "reflective", polarity: "neutral" },
    escapism: { category: "emotional", polarity: "shadow" },
    longing: { category: "emotional", polarity: "neutral" },
    blurred_boundaries: { category: "mental", polarity: "shadow" },

    transformation: { category: "transformational", polarity: "neutral" },
    obsession: { category: "mental", polarity: "shadow" },
    emotional_depth: { category: "emotional", polarity: "neutral" },
    power: { category: "transformational", polarity: "neutral" },
    control: { category: "transformational", polarity: "shadow" },
    release: { category: "transformational", polarity: "light" },
    inner_shift: { category: "reflective", polarity: "neutral" },
    hidden_tension: { category: "emotional", polarity: "shadow" },
};

/* ============================================================
   PLANET PROFILES
============================================================ */

interface PlanetThemeProfile {
    primary: Theme[];
    secondary: Theme[];
    dominance: number;
}

export const PLANET_THEMES: Record<Planet, PlanetThemeProfile> = {
    sun: {
        primary: ["confidence", "identity", "visibility"],
        secondary: ["motivation", "recognition"],
        dominance: 1.4,
    },
    moon: {
        primary: ["emotion", "sensitivity", "intuition"],
        secondary: ["reflection", "comfort", "mood_shift"],
        dominance: 1.5,
    },
    mercury: {
        primary: ["communication", "analysis", "mental_clarity"],
        secondary: ["conversation", "curiosity", "adaptability"],
        dominance: 1.2,
    },
    venus: {
        primary: ["love", "connection", "warmth"],
        secondary: ["romance", "affection", "attraction"],
        dominance: 1.3,
    },
    mars: {
        primary: ["energy", "assertiveness", "motivation"],
        secondary: ["conflict", "impatience", "restlessness"],
        dominance: 1.4,
    },
    jupiter: {
        primary: ["growth", "optimism", "possibility"],
        secondary: ["hope", "exploration", "freedom"],
        dominance: 1.2,
    },
    saturn: {
        primary: ["discipline", "responsibility", "stability"],
        secondary: ["pressure", "fatigue", "restraint"],
        dominance: 1.5,
    },
    uranus: {
        primary: ["change", "breakthrough", "independence"],
        secondary: ["instability", "rebellion", "surprise"],
        dominance: 1.2,
    },
    neptune: {
        primary: ["dreaminess", "intuition", "idealism"],
        secondary: ["confusion", "escapism", "fantasy"],
        dominance: 1.3,
    },
    pluto: {
        primary: ["transformation", "power", "emotional_depth"],
        secondary: ["obsession", "control", "inner_shift"],
        dominance: 1.5,
    },
};

/* ============================================================
   SIGN MODIFIERS
============================================================ */

export const SIGN_THEME_MODIFIERS: Record<ZodiacSign, Theme[]> = {
    aries: ["energy", "assertiveness", "impulsiveness"],
    taurus: ["comfort", "stability", "patience"],
    gemini: ["communication", "curiosity", "adaptability"],
    cancer: ["emotion", "comfort", "sensitivity"],
    leo: ["confidence", "visibility", "recognition"],
    virgo: ["analysis", "discipline", "mental_clarity"],
    libra: ["connection", "romance", "social_ease"],
    scorpio: ["transformation", "obsession", "emotional_depth"],
    sagittarius: ["growth", "exploration", "freedom"],
    capricorn: ["discipline", "responsibility", "pressure"],
    aquarius: ["change", "rebellion", "independence"],
    pisces: ["dreaminess", "intuition", "escapism"],
};

/* ============================================================
   ASPECT WEIGHTS
============================================================ */

export const ASPECT_WEIGHTS: Record<AspectType, number> = {
    conjunction: 1.4,
    opposition: 1.3,
    square: 1.2,
    trine: 1.0,
    sextile: 0.9,
};

export function getOrbMultiplier(orb: number) {
    if (orb <= 1) return 1.5;
    if (orb <= 3) return 1.2;
    if (orb <= 5) return 1.0;

    return 0.7;
}

/* ============================================================
   SPECIAL ASPECT THEMES
============================================================ */

function aspectKey(a: Planet, b: Planet, type: AspectType) {
    return [a, b].sort().join("-") + "-" + type;
}

export const ASPECT_THEME_MAP: Record<string, Theme[]> = {
    [aspectKey("mars", "saturn", "square")]: ["frustration", "pressure", "restraint"],
    [aspectKey("moon", "neptune", "opposition")]: ["confusion", "dreaminess", "longing"],
    [aspectKey("venus", "jupiter", "trine")]: ["romance", "warmth", "optimism"],
    [aspectKey("sun", "pluto", "conjunction")]: ["transformation", "power", "inner_shift"],
    [aspectKey("mercury", "uranus", "conjunction")]: ["breakthrough", "change", "mental_clarity"],
};

/* ============================================================
   RESULT TYPES
============================================================ */

export interface ThemeScore {
    theme: Theme;
    score: number;
}

export interface PlanetDominance {
    planet: Planet;
    score: number;
}

export interface AspectDominance {
    label: string;
    score: number;
}

export interface EnergyProfile {
    emotional: number;
    social: number;
    mental: number;
    romantic: number;
    energetic: number;
    reflective: number;
    transformational: number;
}

export interface PolarityProfile {
    light: number;
    shadow: number;
    neutral: number;
}

/* ============================================================
   PLANET DOMINANCE
============================================================ */

export function calculatePlanetDominance(transits: DailyTransits): PlanetDominance[] {
    const result: Partial<Record<Planet, number>> = {};

    Object.keys(transits.planets).forEach((planetName) => {
        const planet = planetName as Planet;

        result[planet] = PLANET_THEMES[planet].dominance;
    });

    transits.aspects.forEach((aspect) => {
        const weight = ASPECT_WEIGHTS[aspect.type] * getOrbMultiplier(aspect.orb);

        aspect.planets.forEach((planet) => {
            result[planet] = (result[planet] || 0) + weight;
        });
    });

    return Object.entries(result)
        .map(([planet, score]) => ({
            planet: planet as Planet,
            score: Number(score),
        }))
        .sort((a, b) => b.score - a.score);
}

/* ============================================================
   ASPECT DOMINANCE
============================================================ */

export function calculateAspectDominance(transits: DailyTransits): AspectDominance[] {
    return transits.aspects
        .map((aspect) => {
            const score = ASPECT_WEIGHTS[aspect.type] * getOrbMultiplier(aspect.orb);

            return {
                label: `${aspect.planets[0]} ${aspect.type} ${aspect.planets[1]}`,
                score,
            };
        })
        .sort((a, b) => b.score - a.score);
}

/* ============================================================
   THEME SCORING
============================================================ */

export function scoreThemes(transits: DailyTransits): ThemeScore[] {
    const scores: Partial<Record<Theme, number>> = {};

    function add(theme: Theme, value: number) {
        scores[theme] = (scores[theme] || 0) + value;
    }

    /* ========================================================
       PLANETS
    ======================================================== */

    Object.entries(transits.planets).forEach(([planetName, planetData]) => {
        const planet = planetName as Planet;

        const profile = PLANET_THEMES[planet];

        profile.primary.forEach((theme) => {
            add(theme, 2 * profile.dominance);
        });

        profile.secondary.forEach((theme) => {
            add(theme, 1 * profile.dominance);
        });

        /* =================================================
               SIGN THEMES
            ================================================= */

        const signThemes = SIGN_THEME_MODIFIERS[planetData.sign];

        signThemes.forEach((theme) => {
            add(theme, 0.8);
        });
    });

    /* ========================================================
       ASPECTS
    ======================================================== */

    transits.aspects.forEach((aspect) => {
        const weight = ASPECT_WEIGHTS[aspect.type] * getOrbMultiplier(aspect.orb);

        aspect.planets.forEach((planet) => {
            const profile = PLANET_THEMES[planet];

            profile.primary.forEach((theme) => {
                add(theme, weight * 1.8);
            });

            profile.secondary.forEach((theme) => {
                add(theme, weight);
            });
        });

        const key = aspectKey(aspect.planets[0], aspect.planets[1], aspect.type);

        const specialThemes = ASPECT_THEME_MAP[key];

        if (specialThemes) {
            specialThemes.forEach((theme) => {
                add(theme, weight * 2.5);
            });
        }
    });

    return Object.entries(scores)
        .map(([theme, score]) => ({
            theme: theme as Theme,
            score: Number(score),
        }))
        .sort((a, b) => b.score - a.score);
}

/* ============================================================
   ENERGY PROFILE
============================================================ */

export function buildEnergyProfile(scores: ThemeScore[]): EnergyProfile {
    const result: EnergyProfile = {
        emotional: 0,
        social: 0,
        mental: 0,
        romantic: 0,
        energetic: 0,
        reflective: 0,
        transformational: 0,
    };

    scores.forEach(({ theme, score }) => {
        const meta = THEME_META[theme];

        const intensity = meta.intensity ?? 1;

        result[meta.category] += score * intensity;
    });

    return result;
}

/* ============================================================
   POLARITY PROFILE
============================================================ */

export function buildPolarityProfile(scores: ThemeScore[]): PolarityProfile {
    const result: PolarityProfile = {
        light: 0,
        shadow: 0,
        neutral: 0,
    };

    scores.forEach(({ theme, score }) => {
        const meta = THEME_META[theme];

        result[meta.polarity] += score;
    });

    return result;
}

/* ============================================================
   DOMINANT ENERGY
============================================================ */

export function getDominantEnergy(energy: EnergyProfile): ThemeCategory {
    return Object.entries(energy).sort((a, b) => b[1] - a[1])[0][0] as ThemeCategory;
}

/* ============================================================
   ATMOSPHERE
============================================================ */

export function deriveAtmosphere(input: { energy: EnergyProfile; polarity: PolarityProfile; dominantPlanet: Planet }) {
    const dominantEnergy = getDominantEnergy(input.energy);

    const total = input.polarity.light + input.polarity.shadow + input.polarity.neutral;

    const shadowRatio = input.polarity.shadow / total;

    let emotionalTone = "balanced";

    if (shadowRatio >= 0.45) {
        emotionalTone = "tense";
    } else if (shadowRatio <= 0.2) {
        emotionalTone = "open";
    }

    let planetaryAtmosphere = "emotionally active";

    switch (input.dominantPlanet) {
        case "venus":
            planetaryAtmosphere = "socially open";
            break;

        case "mars":
            planetaryAtmosphere = "driven and restless";
            break;

        case "saturn":
            planetaryAtmosphere = "heavy and reflective";
            break;

        case "neptune":
            planetaryAtmosphere = "foggy and emotional";
            break;

        case "pluto":
            planetaryAtmosphere = "deep and transformative";
            break;

        case "moon":
            planetaryAtmosphere = "emotionally heightened";
            break;
    }

    return {
        dominantEnergy,
        emotionalTone,
        planetaryAtmosphere,
        shadowRatio,
    };
}

/* ============================================================
   AREA SCORES
============================================================ */

interface AreaWeights {
    positive: Partial<Record<Theme, number>>;
    negative: Partial<Record<Theme, number>>;
}

export interface AreaScore {
    area: LifeArea;
    score: number;
}

export const AREA_WEIGHTS: Record<LifeArea, AreaWeights> = {
    love: {
        positive: {
            love: 3,
            connection: 3,
            warmth: 2,
            affection: 2,
            romance: 3,
            attraction: 2,
            social_ease: 1,
            communication: 1,
        },

        negative: {
            conflict: 3,
            misunderstanding: 3,
            impatience: 2,
            restlessness: 2,
            hidden_tension: 2,
            overthinking: 1,
        },
    },
    career: {
        positive: {
            motivation: 3,
            discipline: 3,
            clarity: 2,
            mental_clarity: 2,
            confidence: 2,
            growth: 2,
            recognition: 2,
            stability: 1,
            responsibility: 2,
        },
        negative: {
            pressure: 3,
            fatigue: 3,
            confusion: 2,
            impulsiveness: 2,
            frustration: 2,
            instability: 2,
        },
    },
    health: {
        positive: {
            stability: 3,
            patience: 2,
            comfort: 2,
            discipline: 2,
        },
        negative: {
            fatigue: 4,
            pressure: 3,
            escapism: 2,
            restlessness: 2,
            impatience: 2,
            hidden_tension: 2,
        },
    },
    mood: {
        positive: {
            optimism: 3,
            hope: 2,
            comfort: 2,
            confidence: 2,
            openness: 2,
        },
        negative: {
            confusion: 3,
            emotional_need: 2,
            longing: 2,
            hidden_tension: 2,
            mood_shift: 2,
            overthinking: 2,
            frustration: 2,
            fatigue: 2,
        },
    },
};

export function calculateAreaScores(scores: ThemeScore[]): AreaScore[] {
    const result: AreaScore[] = [];

    for (const [area, weights] of Object.entries(AREA_WEIGHTS)) {
        let positive = 0;
        let negative = 0;

        scores.forEach(({ theme, score }) => {
            positive += score * (weights.positive[theme] ?? 0);

            negative += score * (weights.negative[theme] ?? 0);
        });

        const raw = 50 + positive * 2.5 - negative * 2.5;

        const normalized = Math.max(0, Math.min(100, Math.round(raw)));

        result.push({
            area: area as LifeArea,
            score: normalized,
        });
    }

    return result;
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

/* ============================================================
   MAIN ANALYSIS
============================================================ */

export function analyzeTransits(transits: DailyTransits) {
    const themeScores = scoreThemes(transits);

    const energy = buildEnergyProfile(themeScores);

    const polarity = buildPolarityProfile(themeScores);

    const planetDominance = calculatePlanetDominance(transits);

    const aspectDominance = calculateAspectDominance(transits);

    const dominantPlanet = planetDominance[0]?.planet ?? "moon";

    const atmosphere = deriveAtmosphere({
        energy,
        polarity,
        dominantPlanet,
    });

    const areaScores = calculateAreaScores(themeScores);

    const observations = generateObservations(themeScores);

    const moonPlacement = transits.planets.moon.sign;

    const moonPhase = getMoonPhase(transits.planets.sun.longitude, transits.planets.moon.longitude);

    const lunarInfluence = `${MOON_SIGN_INFLUENCE[moonPlacement]} ${MOON_PHASE_INFLUENCE[moonPhase]}`;

    return {
        topThemes: themeScores.slice(0, 10),
        energy,
        polarity,
        dominantPlanet,
        dominantAspects: aspectDominance.slice(0, 5),
        atmosphere,
        areaScores,
        planetDominance,
        themeScores,
        observations,
        moonPlacement,
        moonPhase,
        lunarInfluence,
    };
}

/* ============================================================
   PROMPT BUILDER
============================================================ */

export function buildPrompt(input: {
    analysis: ReturnType<typeof analyzeTransits>;
    sunSign: string;
    moonSign: string;
    language: string;
    relationshipStatus?: string;
    priorities?: string[];
}) {
    const { analysis, sunSign, moonSign, language, relationshipStatus, priorities } = input;

    const topThemes = analysis.topThemes.slice(0, 6).map((x) => x.theme);

    const topAspects = analysis.dominantAspects.slice(0, 3).map((x) => x.label);

    const loveScore = analysis.areaScores.find((x) => x.area === "love")?.score ?? 50;

    const careerScore = analysis.areaScores.find((x) => x.area === "career")?.score ?? 50;

    const healthScore = analysis.areaScores.find((x) => x.area === "health")?.score ?? 50;

    const moodScore = analysis.areaScores.find((x) => x.area === "mood")?.score ?? 50;

    // return `
    //     Write a daily horoscope.

    //     The horoscope should sound like something a real person would genuinely think or notice during the day.

    //     The horoscope should feel:
    //     - observational
    //     - grounded
    //     - socially realistic
    //     - subtly relatable
    //     - natural
    //     - conversational
    //     - simple
    //     - realistic

    //     Focus on:
    //     - everyday emotions
    //     - realistic social situations
    //     - mood changes
    //     - conversations
    //     - reactions between people
    //     - moments of uncertainty
    //     - reflection
    //     - connection
    //     - emotional atmosphere

    //     The horoscope should NOT feel:
    //     - mystical
    //     - spiritual
    //     - poetic
    //     - therapeutic
    //     - inspirational
    //     - emotionally abstract
    //     - vague
    //     - dramatic

    //     Avoid phrases like:
    //     - "inner clarity"
    //     - "authentic connection"
    //     - "emotional energy"
    //     - "the universe"
    //     - "your soul"
    //     - "deep transformation"

    //     Describe:
    //     - situations
    //     - reactions
    //     - emotional patterns
    //     - conversation dynamics
    //     - social behavior

    //     GOOD examples:

    //     "Dnes můžete být citlivější na tón lidí kolem sebe. Některé věci si možná vezmete osobněji než obvykle. Večer přinese větší klid."

    //     "Krátký rozhovor vám může změnit náladu víc, než čekáte. Ne všechno potřebuje okamžité vysvětlení. Dopřejte si trochu odstup."

    //     "Můžete mít chuť stáhnout se víc do sebe. I malé věci dnes budou působit intenzivněji. Nespěchejte na odpovědi."

    //     BAD examples:

    //     "Váš vnitřní citlivý proces způsobí zpožděné reakce."
    //     "Lehká poznámka se propadne s jistou vahou."
    //     "Hlubší ozvěna každodenních výměn."

    //     ==================================================
    //     ASTROLOGICAL STATE
    //     ==================================================

    //     Moon phase:
    //     ${analysis.moonPhase}

    //     Moon placement:
    //     ${analysis.moonPlacement}

    //     Dominant planet:
    //     ${analysis.dominantPlanet}

    //     Dominant energy:
    //     ${analysis.atmosphere.dominantEnergy}

    //     Planetary atmosphere:
    //     ${analysis.atmosphere.planetaryAtmosphere}

    //     Emotional tone:
    //     ${analysis.atmosphere.emotionalTone}

    //     Today's atmosphere:
    //     ${analysis.atmosphere.planetaryAtmosphere}

    //     Main themes:
    //     ${topThemes.join(", ")}

    //     Dominant aspects:
    //     ${topAspects.join(", ")}

    //     Top themes:
    //     ${topThemes.join(", ")}

    //     ==================================================
    //     LIFE SCORES
    //     ==================================================

    //     Love:
    //     ${loveScore}/100

    //     Career:
    //     ${careerScore}/100

    //     Health:
    //     ${healthScore}/100

    //     Mood:
    //     ${moodScore}/100

    //     ==================================================
    //     USER
    //     ==================================================

    //     Sun sign:
    //     ${sunSign}

    //     Moon sign:
    //     ${moonSign}

    //     Relationship status:
    //     ${relationshipStatus ?? "unknown"}

    //     Priorities:
    //     ${priorities?.join(", ") ?? "none"}

    //     ==================================================
    //     OUTPUT
    //     ==================================================

    //     Return ONLY valid JSON:

    //     {
    //         "horoscope": "...",
    //         "moonInsight": "...",
    //         "focus": ["...", "..."],
    //         "caution": ["...", "..."],
    //         "do": "...",
    //         "avoid": "...",
    //         "love": number,
    //         "career": number,
    //         "health": number,
    //         "mood": number
    //     }

    //     ==================================================
    //     RULES
    //     ==================================================

    //     HOROSCOPE:
    //     - 6 to 8 sentences
    //     - split the horoscope into 2–3 short paragraphs
    //     - each paragraph should contain 2–4 sentences
    //     - use line breaks between paragraphs
    //     - avoid one large block of text
    //     - the structure should feel easy to scan and pleasant to read on mobile
    //     - vary sentence length
    //     - some sentences can be longer and more descriptive
    //     - the horoscope should feel immersive and emotionally realistic
    //     - describe small believable moments
    //     - include emotional contrast
    //     - observations should dominate, but subtle guidance is welcome
    //     - avoid repeating the same emotional idea in multiple sentences
    //     - avoid emotional abstraction
    //     - avoid emotional philosophy
    //     - avoid vague emotional language
    //     - focus on realistic emotional/social situations
    //     - avoid generic self-help wording
    //     - avoid sounding like therapy advice
    //     - avoid abstract emotional concepts
    //     - avoid literary wording
    //     - avoid abstract metaphors
    //     - avoid repeating the same emotional idea in multiple sentences
    //     - avoid excessive positivity
    //     - avoid motivational tone
    //     - subtle emotional realism is better than inspiration
    //     - use simple natural ${language} language

    //     The horoscope should feel naturally progressive:
    //     Paragraph 1:
    //     - general mood of the day
    //     - emotional atmosphere

    //     Paragraph 2:
    //     - one believable emotional, social or practical situation
    //     - subtle contrast, tension or realization

    //     Paragraph 3:
    //     - perspective, calm, release, opportunity or useful observation

    //     MOONINSIGHT:
    //     Generate a short lunar insight:
    //     - 1 or 2 sentences
    //     - maximum 25 words
    //     - describe likely emotional tendencies
    //     - practical and relatable
    //     - avoid mystical language
    //     - avoid spiritual language
    //     - avoid predictions

    //     FOCUS:
    //     - exactly 4 relatable areas of attention
    //     - each item should contain 1 or 2 words
    //     - lifestyle-oriented and human
    //     - avoid abstract psychology
    //     - examples:
    //     close friends
    //     texting
    //     routines
    //     flirting
    //     patience
    //     finances
    //     family time
    //     sleep

    //     CAUTION:
    //     - exactly 2 realistic emotional or social pitfalls
    //     - should feel natural and specific
    //     - avoid therapy language
    //     - examples:
    //     mixed signals, overreacting, unnecessary tension, impulse spending, doomscrolling

    //     DO:
    //     - one short recommendation or opportunity for today
    //     - write a complete sentence
    //     - maximum 10 words
    //     - practical, relatable and realistic
    //     - examples:
    //     Reach out to someone first.
    //     Take a longer evening walk.
    //     Finish a small unfinished task.
    //     Make time for a meaningful conversation.
    //     Try something slightly different today.

    //     AVOID:
    //     - one short recommendation about what not to do today
    //     - write a complete sentence
    //     - maximum 10 words
    //     - realistic and specific
    //     - examples:
    //     Don't respond in frustration.
    //     Avoid rushing important decisions.
    //     Don't overthink every message.
    //     Avoid unnecessary online arguments.
    //     Don't ignore signs of fatigue.

    //     IMPORTANT:
    //     - not every day should feel optimistic
    //     - difficult emotional atmospheres are valid
    //     - reflective days are valid
    //     - uncertainty is valid
    //     - emotional complexity is good
    //     - vary sentence length naturally
    //     - combine shorter and longer sentences
    //     - some sentences can contain two connected thoughts
    //     - avoid overly fragmented writing
    //     - write in flowing natural paragraphs
    //     - avoid sentence-per-thought structure
    //     - use simple natural ${language} language
    //     - avoid literary wording
    //     - avoid abstract metaphors

    //     The scores should feel aligned with the astrology.

    //     Respond in following language:
    //     ${language}
    //     `;

    return `
    You are writing a premium daily horoscope for a modern astrology application.
    The user expects a horoscope that feels personal, believable and unique to today's astrology.

    The horoscope should sound like something a real person could genuinely experience during the day, not like a generic horoscope that could apply to anyone.

    ==================================================
    GOAL
    ==================================================

    Create a horoscope that feels:

    - natural
    - grounded
    - emotionally intelligent
    - socially realistic
    - conversational
    - observational
    - relatable
    - immersive

    The reader should feel:

    "This actually sounds like the kind of day I might have."

    The horoscope should describe believable situations rather than abstract emotions.

    ==================================================
    ASTROLOGY FIRST
    ==================================================

    The horoscope must be driven by today's astrology.

    The astrological configuration should determine:

    - the emotional atmosphere
    - the types of situations that are likely to happen
    - how people interact
    - where attention naturally goes
    - what opportunities or challenges become more noticeable

    Different astrology should create noticeably different horoscopes.

    A Saturn-dominated day should not feel like a Venus-dominated day.

    A Mercury day should not resemble a Mars day.

    A Full Moon should not feel like a Waning Crescent.

    The astrology should influence the story itself, not only the mood.

    When several astrological indicators point in different directions, follow this priority:

    1. Dominant aspects
    2. Dominant planet
    3. Moon placement
    4. Moon phase
    5. Dominant themes
    6. Area scores

    ==================================================
    EVERY DAY SHOULD FEEL DIFFERENT
    ==================================================

    Imagine someone reading your horoscope every day for an entire month.

    The experience should never become repetitive.

    Avoid reusing the same situations, emotional dynamics or narrative structure across different days.

    Rotate naturally between different areas of everyday life.

    Possible themes include:

    - work
    - productivity
    - routines
    - finances
    - creativity
    - family
    - relationships
    - dating
    - friendships
    - home
    - travel
    - health
    - physical energy
    - planning
    - hobbies
    - technology
    - learning
    - unexpected events
    - confidence
    - communication
    - rest

    Do not make every horoscope primarily about emotions.

    Do not make every horoscope primarily about conversations.

    Do not make every horoscope primarily about relationships.

    Choose one or two life areas that naturally fit today's astrology.

    ==================================================
    WRITING STYLE
    ==================================================

    The writing should feel:

    - simple
    - modern
    - human
    - emotionally believable
    - specific
    - easy to read

    Avoid sounding:

    - mystical
    - spiritual
    - poetic
    - dramatic
    - philosophical
    - therapeutic
    - motivational
    - inspirational

    Avoid abstract expressions such as:

    - inner clarity
    - authentic connection
    - emotional energy
    - the universe
    - your soul
    - destiny
    - deep transformation
    - higher purpose

    Prefer concrete situations over abstract observations.

    Instead of describing feelings in isolation, describe situations that naturally create those feelings.

    GOOD

    "A short conversation may leave you thinking longer than expected."

    "You finally finish something you've been postponing."

    "Someone may ask for your opinion when you weren't expecting it."

    "Plans could change during the afternoon, but the new direction may suit you better."

    BAD

    "You are experiencing emotional transformation."

    "Your inner energy shifts."

    "The universe encourages growth."

    "Your soul seeks clarity."

    ==================================================
    ASTROLOGICAL STATE
    ==================================================

    Use the following information as the foundation of today's horoscope.

    The horoscope should naturally reflect the dominant influences rather than mentioning them directly.

    Do not mention planets, aspects, zodiac signs or astrology in the horoscope itself.

    Instead, translate the astrology into believable everyday situations, emotional tendencies and social dynamics.

    Moon phase:
    ${analysis.moonPhase}

    Moon placement:
    ${analysis.moonPlacement}

    Lunar influence:
    ${analysis.lunarInfluence}

    Dominant planet:
    ${analysis.dominantPlanet}

    Dominant energy:
    ${analysis.atmosphere.dominantEnergy}

    Planetary atmosphere:
    ${analysis.atmosphere.planetaryAtmosphere}

    Emotional tone:
    ${analysis.atmosphere.emotionalTone}

    Main themes:
    ${topThemes.join(", ")}

    Dominant aspects:
    ${topAspects.join(", ")}

    ==================================================
    LIFE SCORES
    ==================================================

    These scores represent today's overall tendencies.

    Higher scores should create noticeably more opportunities.

    Lower scores should create more friction, uncertainty or slower progress.

    Do not force every area into the horoscope.

    Focus naturally on the areas that today's astrology emphasizes.

    Love:
    ${loveScore}/100

    Career:
    ${careerScore}/100

    Health:
    ${healthScore}/100

    Mood:
    ${moodScore}/100

    ==================================================
    USER
    ==================================================

    Sun sign:
    ${sunSign}

    Moon sign:
    ${moonSign}

    Relationship status:
    ${relationshipStatus ?? "unknown"}

    Priorities:
    ${priorities?.join(", ") ?? "none"}

    The horoscope should feel personally relevant without explicitly mentioning the user's Sun sign, Moon sign or relationship status.

    If the user's priorities naturally align with today's astrology, gently incorporate them.

    Never force them into the narrative.

    ==================================================
    OUTPUT
    ==================================================

    Return ONLY valid JSON.

    {
    "horoscope": "...",
    "moonInsight": "...",
    "focus": [
        "...",
        "...",
        "...",
        "..."
    ],
    "caution": [
        "...",
        "..."
    ],
    "do": "...",
    "avoid": "...",
    "love": number,
    "career": number,
    "health": number,
    "mood": number
    }

    Do not return markdown.

    Do not wrap the JSON in code fences.

    Do not include explanations.

    Return only the JSON object.

    ==================================================
    HOROSCOPE
    ==================================================

    Write a horoscope consisting of 6–8 sentences.

    Split the horoscope into 2–3 short paragraphs.

    Separate paragraphs with blank lines.

    The text should be comfortable to read on a mobile device.

    Vary sentence length naturally.

    Some sentences may be short and direct.

    Others may be slightly longer and more descriptive.

    The horoscope should read like a small story about today's atmosphere rather than a collection of unrelated observations.

    ==================================================
    BUILD THE DAY
    ==================================================

    The horoscope should naturally progress through the day.

    Paragraph 1
    Introduce today's overall atmosphere.

    Help the reader immediately recognize today's mood.

    Paragraph 2
    Describe one believable everyday situation influenced by today's astrology.

    Prefer concrete events over abstract emotions.

    Examples include:

    - a conversation
    - work
    - home life
    - family
    - a partner
    - friends
    - making plans
    - unexpected changes
    - money
    - travel
    - creativity
    - health
    - routines
    - hobbies

    The situation should feel ordinary but memorable.

    Paragraph 3
    End with perspective, resolution, opportunity or quiet realization.

    The ending should feel satisfying without sounding inspirational.

    ==================================================
    REALISM
    ==================================================

    Describe situations that people genuinely experience.

    Examples:

    - someone replies later than expected
    - plans suddenly change
    - an unfinished task returns
    - you receive unexpected appreciation
    - someone asks for your help
    - you finally make a decision
    - a small misunderstanding clears up
    - an old idea becomes useful again
    - you notice something everyone else missed
    - you unexpectedly have time for yourself

    Prefer actions over emotions.

    Instead of saying:

    "You feel uncertain."

    Describe why:

    "You may realize that two different people expect different things from you."

    Instead of saying:

    "You become more confident."

    Describe what happens:

    "A small success may encourage you to continue something you almost gave up."

    ==================================================
    NARRATIVE DIVERSITY
    ==================================================

    Every horoscope should have its own identity.

    Avoid repeating the same story structure.

    Avoid repeatedly writing about:

    - analyzing conversations
    - reading between the lines
    - emotional sensitivity
    - misunderstanding messages
    - noticing subtle moods
    - overthinking
    - observing other people's emotions

    These situations are valid occasionally but should never dominate multiple consecutive days.

    Rotate naturally between different kinds of days.

    Examples:

    - practical day
    - productive day
    - social day
    - romantic day
    - creative day
    - family-oriented day
    - reflective day
    - energetic day
    - slow day
    - spontaneous day
    - organized day
    - playful day

    The dominant astrology should determine which type of day today's horoscope becomes.

    ==================================================
    WRITING QUALITY
    ==================================================

    Show rather than explain.

    Describe believable situations instead of emotional theories.

    Avoid generic self-help advice.

    Avoid therapy language.

    Avoid motivational language.

    Avoid philosophical observations.

    Avoid clichés.

    Avoid abstract metaphors.

    Avoid literary wording.

    Avoid repeating the same emotional idea.

    Avoid repeating the same situation.

    Avoid repeatedly beginning sentences with:

    - You may...
    - You might...
    - It may...
    - Today you may...

    Vary sentence openings naturally.

    The horoscope should sound like something written by an excellent columnist rather than an AI.

    ==================================================
    MOON INSIGHT
    ==================================================

    Generate one short lunar insight.

    Length:

    - 1–2 sentences
    - maximum 25 words

    Purpose:

    Briefly explain how today's Moon placement and Moon phase may influence the emotional atmosphere.

    The insight should:

    - be practical
    - be relatable
    - feel contemporary
    - avoid predictions
    - avoid mystical language
    - avoid spiritual language
    - avoid mentioning astrology directly

    GOOD

    "You may find it easier to trust your first impression today."

    "Small emotional signals may stand out more than usual."

    "A familiar environment may feel especially comforting."

    BAD

    "The Moon awakens your soul."

    "Cosmic energy surrounds you."

    "You are entering a higher vibration."

    ==================================================
    FOCUS
    ==================================================

    Generate exactly 4 focus areas.

    Each item should contain 1 or 2 words.

    They should feel practical, relatable and connected to today's astrology.

    Do not simply repeat the horoscope.

    Instead, highlight areas of life that deserve extra attention today.

    Examples:

    - close friends
    - routines
    - family time
    - planning
    - creativity
    - finances
    - sleep
    - communication
    - exercise
    - home projects
    - patience
    - learning
    - confidence
    - travel
    - organization
    - boundaries

    Avoid abstract concepts.

    ==================================================
    CAUTION
    ==================================================

    Generate exactly 2 realistic pitfalls.

    Each item should describe something that could realistically create unnecessary friction today.

    Keep them short.

    Examples:

    - mixed signals
    - impulse spending
    - unnecessary tension
    - rushing decisions
    - procrastination
    - skipped breaks
    - forgotten details
    - unrealistic expectations
    - overcommitting
    - emotional reactions

    Avoid generic psychology.

    Avoid therapy language.

    ==================================================
    DO
    ==================================================

    Write one short recommendation.

    Maximum 10 words.

    Use a complete sentence.

    The recommendation should describe something worth doing today.

    It may also describe a small opportunity.

    Examples:

    Call someone you've been thinking about.

    Finish one unfinished task.

    Take a longer evening walk.

    Say yes to new plans.

    Organize your workspace.

    Cook something comforting.

    ==================================================
    AVOID
    ==================================================

    Write one short recommendation.

    Maximum 10 words.

    Use a complete sentence.

    Describe one behavior worth avoiding today.

    Examples:

    Don't rush important conversations.

    Avoid unnecessary online arguments.

    Don't ignore your body's signals.

    Avoid making impulsive purchases.

    Don't promise more than you can deliver.

    ==================================================
    SCORES
    ==================================================

    Return the provided Love, Career, Health and Mood scores.

    Do not invent new values.

    The horoscope should naturally reflect these scores.

    High scores should feel noticeably easier.

    Low scores should introduce believable obstacles.

    Avoid making every area equally positive.

    ==================================================
    FINAL QUALITY CHECK
    ==================================================

    Before producing the final JSON, silently verify that:

    - today's horoscope clearly reflects the provided astrology
    - it could not easily fit a different astrological day
    - the situations feel believable
    - the story contains at least one concrete everyday moment
    - the writing feels natural and human
    - the horoscope avoids clichés
    - different parts of life are represented across different days
    - emotions are explained through situations rather than abstract statements
    - the ending feels calm but not artificially optimistic
    - no sentence feels like generic self-help
    - the horoscope has its own identity

    If the horoscope feels similar to a typical horoscope generated on another day, rewrite it.

    The reader should immediately feel that today's horoscope is unique to today's astrology.

    Respond only in:

    ${language} language.
    `;
}

/* ============================================================
   GENERATE DAILY INSIGHT
============================================================ */

export async function generateDailyInsight(input: {
    transits: DailyTransits;
    sunSign: string;
    moonSign: string;
    language: string;
    relationshipStatus?: string;
    priorities?: string[];
    goals?: string[];
}) {
    const analysis = analyzeTransits(input.transits);

    const prompt = buildPrompt({
        analysis,
        sunSign: input.sunSign,
        moonSign: input.moonSign,
        relationshipStatus: input.relationshipStatus,
        priorities: input.priorities,
        language: input.language,
    });

    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
    });

    console.log("======== PROMPT =========");
    console.log(JSON.stringify(prompt));
    console.log("======== PROMPT =========");
    console.log("======== RESPONSE =========");
    console.log(JSON.stringify(response.text));
    console.log("======== RESPONSE =========");

    const text = response.text ?? "";

    const result = parseLLMJson<{
        horoscope: string;
        moonInsight: string;

        focus: string[];
        caution: string[];

        do: string;
        avoid: string;

        love: number;
        career: number;
        health: number;
        mood: number;
    }>(text);

    if (!result) {
        throw new Error("Failed to parse horoscope response");
    }

    return {
        horoscope: result.horoscope,
        moonInsight: result.moonInsight,
        focus: result.focus,
        caution: result.caution,
        do: result.do,
        avoid: result.avoid,
        scores: {
            love: result.love,
            career: result.career,
            health: result.health,
            mood: result.mood,
        },
        debug: {
            dominantPlanet: analysis.dominantPlanet,
            dominantEnergy: analysis.atmosphere.dominantEnergy,
            planetaryAtmosphere: analysis.atmosphere.planetaryAtmosphere,
            emotionalTone: analysis.atmosphere.emotionalTone,
            shadowRatio: analysis.atmosphere.shadowRatio,
            topThemes: analysis.topThemes,
            dominantAspects: analysis.dominantAspects,
            energy: analysis.energy,
            polarity: analysis.polarity,
            areaScores: analysis.areaScores,
            planetDominance: analysis.planetDominance,
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
    themes: string[];
    /**
     * Oblasti života, které objekt nejvíce ovlivňuje.
     */
    lifeAreas: Partial<Record<LifeArea, number>>;
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
    id: Aspect;

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
