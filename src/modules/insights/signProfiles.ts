import { ZodiacSign } from "../../utils/natalUtils";
import { SignProfile } from "../insights";

export const SIGN_PROFILES: Record<ZodiacSign, SignProfile> = {
    aries: {
        id: "aries",

        displayName: "Aries",

        description: "Expresses energy through initiative, courage and direct action.",

        themes: ["motivation", "energy", "assertiveness", "desire_for_progress", "impatience"],

        modifiers: {
            activity: 100,
            emotion: 35,
            intellect: 45,
            spirituality: 20,
        },

        expression: {
            communication: [
                "speaks directly",
                "states opinions confidently",
                "prefers honest and immediate conversations",
                "responds quickly",
            ],

            relationships: [
                "takes initiative",
                "values independence",
                "enjoys excitement and spontaneity",
                "may become impatient with emotional uncertainty",
            ],

            work: [
                "acts decisively",
                "starts projects enthusiastically",
                "embraces challenges",
                "prefers fast-paced environments",
            ],

            wellbeing: ["benefits from physical activity", "needs regular challenges", "regains energy through action"],
        },

        strengths: ["initiative", "courage", "decisiveness", "confidence", "enthusiasm", "resilience"],

        challenges: ["impatience", "impulsiveness", "acting before thinking", "difficulty slowing down"],

        keywords: ["initiative", "action", "independence", "boldness", "competition", "momentum"],
    },
    taurus: {
        id: "taurus",

        displayName: "Taurus",

        description: "Expresses energy through stability, patience and steady progress.",

        themes: ["stability", "comfort", "patience", "warmth", "affection", "restraint"],

        modifiers: {
            activity: 45,
            emotion: 70,
            intellect: 45,
            spirituality: 40,
        },

        expression: {
            communication: [
                "speaks calmly and thoughtfully",
                "prefers practical conversations",
                "chooses words carefully",
                "rarely changes opinions quickly",
            ],

            relationships: [
                "builds trust slowly",
                "values loyalty and consistency",
                "shows affection through reliability",
                "prefers long-term commitment",
            ],

            work: [
                "works patiently toward long-term goals",
                "values quality over speed",
                "creates stable routines",
                "remains persistent through challenges",
            ],

            wellbeing: [
                "benefits from routine and stability",
                "recharges through comfort and nature",
                "needs time to slow down",
            ],
        },

        strengths: ["patience", "reliability", "loyalty", "persistence", "consistency", "practicality"],

        challenges: ["stubbornness", "resistance to change", "attachment to comfort", "difficulty adapting quickly"],

        keywords: ["stability", "patience", "security", "reliability", "comfort", "endurance"],
    },
    gemini: {
        id: "gemini",

        displayName: "Gemini",

        description: "Expresses energy through curiosity, communication and adaptability.",

        themes: ["communication", "conversation", "curiosity", "adaptability", "mental_clarity", "openness"],

        modifiers: {
            activity: 70,
            emotion: 40,
            intellect: 95,
            spirituality: 30,
        },

        expression: {
            communication: [
                "communicates easily and naturally",
                "asks questions",
                "shares ideas enthusiastically",
                "enjoys exchanging perspectives",
            ],

            relationships: [
                "connects through conversation",
                "needs intellectual stimulation",
                "values flexibility",
                "enjoys meeting new people",
            ],

            work: [
                "learns quickly",
                "adapts to changing situations",
                "handles multiple tasks comfortably",
                "prefers variety over routine",
            ],

            wellbeing: ["benefits from learning", "needs mental stimulation", "recharges through new experiences"],
        },

        strengths: ["adaptability", "communication", "curiosity", "versatility", "quick learning", "open-mindedness"],

        challenges: ["restlessness", "overthinking", "difficulty focusing", "inconsistency"],

        keywords: ["communication", "curiosity", "learning", "adaptability", "ideas", "versatility"],
    },
    cancer: {
        id: "cancer",

        displayName: "Cancer",

        description: "Expresses energy through care, emotional awareness and protection.",

        themes: ["emotion", "comfort", "emotional_need", "intuition", "connection", "sensitivity"],

        modifiers: {
            activity: 35,
            emotion: 95,
            intellect: 40,
            spirituality: 70,
        },

        expression: {
            communication: [
                "communicates with empathy",
                "listens carefully",
                "expresses feelings gently",
                "prefers emotionally honest conversations",
            ],

            relationships: [
                "creates emotional safety",
                "protects loved ones",
                "values loyalty and closeness",
                "builds deep emotional bonds",
            ],

            work: [
                "supports others patiently",
                "works best in stable environments",
                "values meaningful collaboration",
                "cares about team wellbeing",
            ],

            wellbeing: [
                "benefits from emotional security",
                "needs time to recharge",
                "finds comfort in familiar routines",
            ],
        },

        strengths: ["empathy", "loyalty", "compassion", "protectiveness", "emotional intelligence", "devotion"],

        challenges: ["emotional sensitivity", "holding onto the past", "difficulty letting go", "withdrawal when hurt"],

        keywords: ["care", "protection", "family", "security", "nurturing", "belonging"],
    },
    leo: {
        id: "leo",

        displayName: "Leo",

        description: "Expresses energy through confidence, creativity and generous self-expression.",

        themes: ["confidence", "visibility", "recognition", "self_expression", "warmth", "motivation"],

        modifiers: {
            activity: 85,
            emotion: 65,
            intellect: 55,
            spirituality: 35,
        },

        expression: {
            communication: [
                "speaks confidently",
                "shares ideas with enthusiasm",
                "inspires others naturally",
                "enjoys being expressive",
            ],

            relationships: [
                "shows affection generously",
                "values appreciation and loyalty",
                "encourages others to succeed",
                "creates warmth and positivity",
            ],

            work: [
                "takes initiative confidently",
                "motivates others",
                "enjoys visible responsibilities",
                "thrives when creativity is valued",
            ],

            wellbeing: [
                "benefits from creative expression",
                "needs opportunities to shine",
                "regains energy through play and purpose",
            ],
        },

        strengths: ["confidence", "generosity", "charisma", "leadership", "creativity", "enthusiasm"],

        challenges: ["pride", "need for recognition", "stubbornness", "difficulty accepting criticism"],

        keywords: ["confidence", "leadership", "creativity", "generosity", "charisma", "expression"],
    },
    virgo: {
        id: "virgo",

        displayName: "Virgo",

        description: "Expresses energy through precision, practicality and thoughtful improvement.",

        themes: ["analysis", "mental_clarity", "discipline", "responsibility", "patience", "adaptability"],

        modifiers: {
            activity: 55,
            emotion: 35,
            intellect: 95,
            spirituality: 40,
        },

        expression: {
            communication: [
                "communicates clearly",
                "asks thoughtful questions",
                "focuses on practical details",
                "prefers precise language",
            ],

            relationships: [
                "shows care through helpful actions",
                "values reliability",
                "supports others practically",
                "builds trust through consistency",
            ],

            work: [
                "works carefully and efficiently",
                "organizes information",
                "improves existing systems",
                "maintains high standards",
            ],

            wellbeing: [
                "benefits from healthy routines",
                "needs order and balance",
                "regains confidence through preparation",
            ],
        },

        strengths: ["precision", "reliability", "organization", "analytical thinking", "practicality", "dedication"],

        challenges: ["perfectionism", "self-criticism", "overthinking", "difficulty relaxing"],

        keywords: ["precision", "service", "organization", "analysis", "improvement", "practicality"],
    },
    libra: {
        id: "libra",

        displayName: "Libra",

        description: "Expresses energy through harmony, balance and thoughtful cooperation.",

        themes: ["connection", "balance", "cooperation", "social_ease", "beauty", "conversation"],

        modifiers: {
            activity: 50,
            emotion: 65,
            intellect: 75,
            spirituality: 45,
        },

        expression: {
            communication: [
                "communicates diplomatically",
                "considers multiple perspectives",
                "seeks common ground",
                "prefers respectful dialogue",
            ],

            relationships: [
                "values equality and fairness",
                "creates harmony",
                "invests in mutual understanding",
                "enjoys companionship",
            ],

            work: [
                "works well in partnerships",
                "mediates disagreements",
                "creates balanced solutions",
                "values collaboration",
            ],

            wellbeing: [
                "benefits from peaceful environments",
                "needs healthy relationships",
                "finds balance through beauty and creativity",
            ],
        },

        strengths: ["diplomacy", "fairness", "cooperation", "kindness", "adaptability", "social intelligence"],

        challenges: ["avoiding conflict", "indecisiveness", "people pleasing", "difficulty making difficult choices"],

        keywords: ["balance", "harmony", "cooperation", "fairness", "relationships", "diplomacy"],
    },
    scorpio: {
        id: "scorpio",

        displayName: "Scorpio",

        description: "Expresses energy through intensity, emotional depth and transformation.",

        themes: ["transformation", "emotional_depth", "hidden_tension", "release"],

        modifiers: {
            activity: 55,
            emotion: 95,
            intellect: 70,
            spirituality: 75,
        },

        expression: {
            communication: [
                "speaks with purpose",
                "prefers meaningful conversations",
                "observes before responding",
                "communicates honestly about difficult topics",
            ],

            relationships: [
                "forms deep emotional bonds",
                "values trust above all",
                "protects emotional vulnerability",
                "expects loyalty and honesty",
            ],

            work: [
                "investigates root causes",
                "handles pressure calmly",
                "embraces meaningful change",
                "works with determination",
            ],

            wellbeing: [
                "benefits from emotional honesty",
                "needs healthy emotional release",
                "grows through self-reflection",
            ],
        },

        strengths: ["resilience", "determination", "emotional depth", "focus", "loyalty", "inner strength"],

        challenges: ["jealousy", "possessiveness", "holding grudges", "difficulty trusting others"],

        keywords: ["depth", "transformation", "trust", "intensity", "resilience", "mystery"],
    },
    sagittarius: {
        id: "sagittarius",

        displayName: "Sagittarius",

        description: "Expresses energy through exploration, optimism and an open-minded pursuit of meaning.",

        themes: ["optimism", "exploration", "growth", "freedom", "hope", "openness"],

        modifiers: {
            activity: 85,
            emotion: 50,
            intellect: 80,
            spirituality: 80,
        },

        expression: {
            communication: [
                "shares ideas enthusiastically",
                "speaks honestly",
                "enjoys philosophical discussions",
                "encourages others to think broadly",
            ],

            relationships: [
                "values honesty and independence",
                "enjoys shared adventures",
                "supports personal growth",
                "dislikes possessiveness",
            ],

            work: [
                "embraces new opportunities",
                "thinks strategically",
                "learns continuously",
                "motivates others with vision",
            ],

            wellbeing: [
                "benefits from exploration",
                "needs variety and freedom",
                "regains energy through learning and travel",
            ],
        },

        strengths: ["optimism", "curiosity", "adaptability", "vision", "enthusiasm", "generosity"],

        challenges: ["restlessness", "overconfidence", "impatience with routine", "overcommitting"],

        keywords: ["exploration", "freedom", "growth", "adventure", "wisdom", "optimism"],
    },
    capricorn: {
        id: "capricorn",

        displayName: "Capricorn",

        description: "Expresses energy through discipline, responsibility and steady achievement.",

        themes: ["discipline", "responsibility", "stability", "patience", "seriousness", "restraint"],

        modifiers: {
            activity: 70,
            emotion: 30,
            intellect: 75,
            spirituality: 45,
        },

        expression: {
            communication: [
                "speaks thoughtfully and with purpose",
                "prefers practical discussions",
                "communicates clearly and responsibly",
                "avoids unnecessary exaggeration",
            ],

            relationships: [
                "builds trust through consistency",
                "values loyalty and commitment",
                "shows care through reliability",
                "takes relationships seriously",
            ],

            work: [
                "plans carefully before acting",
                "works persistently toward long-term goals",
                "accepts responsibility willingly",
                "maintains high standards",
            ],

            wellbeing: [
                "benefits from structure and routine",
                "needs achievable long-term goals",
                "regains confidence through steady progress",
            ],
        },

        strengths: ["discipline", "perseverance", "responsibility", "reliability", "ambition", "patience"],

        challenges: ["workaholism", "self-criticism", "emotional reserve", "difficulty relaxing"],

        keywords: ["discipline", "achievement", "responsibility", "structure", "endurance", "mastery"],
    },
    aquarius: {
        id: "aquarius",

        displayName: "Aquarius",

        description: "Expresses energy through originality, independence and progressive thinking.",

        themes: ["change", "independence", "breakthrough", "curiosity", "openness", "adaptability"],

        modifiers: {
            activity: 70,
            emotion: 35,
            intellect: 95,
            spirituality: 65,
        },

        expression: {
            communication: [
                "shares original ideas",
                "questions assumptions",
                "encourages independent thinking",
                "enjoys unconventional discussions",
            ],

            relationships: [
                "values equality and authenticity",
                "needs personal freedom",
                "supports individuality",
                "prefers relationships without unnecessary expectations",
            ],

            work: [
                "approaches work independently",
                "enjoys unconventional methods",
                "questions established processes",
                "adapts easily to change",
            ],

            wellbeing: [
                "benefits from intellectual freedom",
                "needs variety and innovation",
                "recharges through new ideas and experiences",
            ],
        },

        strengths: ["innovation", "originality", "adaptability", "vision", "independence", "open-mindedness"],

        challenges: ["emotional detachment", "rebelliousness", "unpredictability", "difficulty following routine"],

        keywords: ["innovation", "freedom", "progress", "originality", "future", "individuality"],
    },
    pisces: {
        id: "pisces",

        displayName: "Pisces",

        description: "Expresses energy through compassion, imagination and intuitive understanding.",

        themes: ["intuition", "emotion", "idealism", "dreaminess", "compassion", "reflection"],

        modifiers: {
            activity: 25,
            emotion: 90,
            intellect: 45,
            spirituality: 100,
        },

        expression: {
            communication: [
                "communicates with empathy",
                "expresses ideas creatively",
                "understands unspoken emotions",
                "prefers gentle conversations",
            ],

            relationships: [
                "forms compassionate connections",
                "offers unconditional support",
                "values emotional understanding",
                "seeks deep spiritual connection",
            ],

            work: [
                "thrives in meaningful and creative work",
                "approaches problems intuitively",
                "supports others with compassion",
                "prefers purpose over recognition",
            ],

            wellbeing: [
                "benefits from solitude and reflection",
                "needs healthy emotional boundaries",
                "finds balance through creativity and spirituality",
            ],
        },

        strengths: ["compassion", "intuition", "creativity", "adaptability", "empathy", "imagination"],

        challenges: ["escapism", "idealizing reality", "unclear boundaries", "emotional overwhelm"],

        keywords: ["compassion", "intuition", "imagination", "spirituality", "empathy", "dreams"],
    },
};
