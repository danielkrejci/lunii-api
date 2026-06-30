import { transit } from "../db/schema";
import { ai } from "../lib/ai";
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

export type ZodiacSign =
    | "aries"
    | "taurus"
    | "gemini"
    | "cancer"
    | "leo"
    | "virgo"
    | "libra"
    | "scorpio"
    | "sagittarius"
    | "capricorn"
    | "aquarius"
    | "pisces";

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
    | "hidden_tension";

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

    return `
        Write a daily horoscope.

        The horoscope should sound like something a real person would genuinely think or notice during the day.

        The horoscope should feel:
        - observational
        - grounded
        - socially realistic
        - subtly relatable
        - natural
        - conversational
        - simple
        - realistic

        Focus on:
        - everyday emotions
        - realistic social situations
        - mood changes
        - conversations
        - reactions between people
        - moments of uncertainty
        - reflection
        - connection
        - emotional atmosphere

        The horoscope should NOT feel:
        - mystical
        - spiritual
        - poetic
        - therapeutic
        - inspirational
        - emotionally abstract
        - vague
        - dramatic

        Avoid phrases like:
        - "inner clarity"
        - "authentic connection"
        - "emotional energy"
        - "the universe"
        - "your soul"
        - "deep transformation"

        Describe:
        - situations
        - reactions
        - emotional patterns
        - conversation dynamics
        - social behavior

        GOOD examples:

        "Dnes můžete být citlivější na tón lidí kolem sebe. Některé věci si možná vezmete osobněji než obvykle. Večer přinese větší klid."

        "Krátký rozhovor vám může změnit náladu víc, než čekáte. Ne všechno potřebuje okamžité vysvětlení. Dopřejte si trochu odstup."

        "Můžete mít chuť stáhnout se víc do sebe. I malé věci dnes budou působit intenzivněji. Nespěchejte na odpovědi."

        BAD examples:

        "Váš vnitřní citlivý proces způsobí zpožděné reakce."
        "Lehká poznámka se propadne s jistou vahou."
        "Hlubší ozvěna každodenních výměn."

        ==================================================
        ASTROLOGICAL STATE
        ==================================================

        Moon phase:
        ${analysis.moonPhase}

        Moon placement:
        ${analysis.moonPlacement}

        Dominant planet:
        ${analysis.dominantPlanet}

        Dominant energy:
        ${analysis.atmosphere.dominantEnergy}

        Planetary atmosphere:
        ${analysis.atmosphere.planetaryAtmosphere}

        Emotional tone:
        ${analysis.atmosphere.emotionalTone}

        Today's atmosphere:
        ${analysis.atmosphere.planetaryAtmosphere}

        Main themes:
        ${topThemes.join(", ")}

        Dominant aspects:
        ${topAspects.join(", ")}

        Top themes:
        ${topThemes.join(", ")}

        ==================================================
        LIFE SCORES
        ==================================================

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

        ==================================================
        OUTPUT
        ==================================================

        Return ONLY valid JSON:

        {
            "horoscope": "...",
            "moonInsight": "...",
            "focus": ["...", "..."],
            "caution": ["...", "..."],
            "do": "...",
            "avoid": "...",
            "love": number,
            "career": number,
            "health": number,
            "mood": number
        }

        ==================================================
        RULES
        ==================================================

        HOROSCOPE:
        - 6 to 8 sentences
        - split the horoscope into 2–3 short paragraphs
        - each paragraph should contain 2–4 sentences
        - use line breaks between paragraphs
        - avoid one large block of text
        - the structure should feel easy to scan and pleasant to read on mobile
        - vary sentence length
        - some sentences can be longer and more descriptive
        - the horoscope should feel immersive and emotionally realistic
        - describe small believable moments
        - include emotional contrast
        - observations should dominate, but subtle guidance is welcome
        - avoid repeating the same emotional idea in multiple sentences
        - avoid emotional abstraction
        - avoid emotional philosophy
        - avoid vague emotional language
        - focus on realistic emotional/social situations
        - avoid generic self-help wording
        - avoid sounding like therapy advice
        - avoid abstract emotional concepts
        - avoid literary wording
        - avoid abstract metaphors
        - avoid repeating the same emotional idea in multiple sentences
        - avoid excessive positivity
        - avoid motivational tone
        - subtle emotional realism is better than inspiration
        - use simple natural ${language} language

        The horoscope should feel naturally progressive:
        Paragraph 1:
        - general mood of the day
        - emotional atmosphere

        Paragraph 2:
        - one believable emotional, social or practical situation
        - subtle contrast, tension or realization

        Paragraph 3:
        - perspective, calm, release, opportunity or useful observation

        MOONINSIGHT:
        Generate a short lunar insight:
        - 1 or 2 sentences
        - maximum 25 words
        - describe likely emotional tendencies
        - practical and relatable
        - avoid mystical language
        - avoid spiritual language
        - avoid predictions

        FOCUS:
        - exactly 4 relatable areas of attention
        - each item should contain 1 or 2 words
        - lifestyle-oriented and human
        - avoid abstract psychology
        - examples:
        close friends
        texting
        routines
        flirting
        patience
        finances
        family time
        sleep

        CAUTION:
        - exactly 2 realistic emotional or social pitfalls
        - should feel natural and specific
        - avoid therapy language
        - examples:
        mixed signals, overreacting, unnecessary tension, impulse spending, doomscrolling

        DO:
        - one short recommendation or opportunity for today
        - write a complete sentence
        - maximum 10 words
        - practical, relatable and realistic
        - examples:
        Reach out to someone first.
        Take a longer evening walk.
        Finish a small unfinished task.
        Make time for a meaningful conversation.
        Try something slightly different today.

        AVOID:
        - one short recommendation about what not to do today
        - write a complete sentence
        - maximum 10 words
        - realistic and specific
        - examples:
        Don't respond in frustration.
        Avoid rushing important decisions.
        Don't overthink every message.
        Avoid unnecessary online arguments.
        Don't ignore signs of fatigue.

        IMPORTANT:
        - not every day should feel optimistic
        - difficult emotional atmospheres are valid
        - reflective days are valid
        - uncertainty is valid
        - emotional complexity is good
        - vary sentence length naturally
        - combine shorter and longer sentences
        - some sentences can contain two connected thoughts
        - avoid overly fragmented writing
        - write in flowing natural paragraphs
        - avoid sentence-per-thought structure
        - use simple natural ${language} language
        - avoid literary wording
        - avoid abstract metaphors
        

        The scores should feel aligned with the astrology.

        Respond in following language:
        ${language}
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
