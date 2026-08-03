import { AspectProfile, AspectType } from "../insights";

export const ASPECT_PROFILES: Record<AspectType, AspectProfile> = {
    conjunction: {
        id: "conjunction",

        displayName: "Conjunction",

        description: "Blends two energies into a unified expression, amplifying their combined influence.",

        themes: ["connection", "energy", "focus", "motivation", "intensity", "self_expression"],

        interaction: {
            harmony: 65,
            intensity: 100,
            friction: 40,
            growth: 90,
        },

        dynamics: {
            communication: [
                "combines different perspectives into a single voice",
                "strengthens focus on shared priorities",
                "encourages direct and concentrated expression",
                "can become one-sided when balance is lost",
            ],

            relationships: [
                "creates powerful bonds through shared purpose",
                "intensifies emotional or practical involvement",
                "encourages mutual commitment",
                "may blur healthy boundaries",
            ],

            work: [
                "supports concentrated effort",
                "amplifies strengths and ambitions",
                "encourages complete dedication",
                "can lead to overidentification with goals",
            ],

            wellbeing: [
                "benefits from clear priorities",
                "requires balance between intensity and recovery",
                "grows through conscious integration of different needs",
            ],
        },

        opportunities: [
            "develop strong focus",
            "unify different strengths",
            "act with confidence and commitment",
            "build lasting momentum",
        ],

        challenges: [
            "overidentifying with one area of life",
            "difficulty maintaining perspective",
            "intensity becoming overwhelming",
            "ignoring complementary viewpoints",
        ],

        guidance: {
            embrace: [
                "integrate both energies consciously",
                "use the increased focus constructively",
                "recognize the strengths of the combination",
            ],

            avoid: [
                "becoming consumed by one priority",
                "acting without reflection",
                "allowing intensity to overshadow balance",
            ],
        },

        keywords: ["fusion", "unity", "focus", "amplification", "intensity", "integration"],
    },
    sextile: {
        id: "sextile",

        displayName: "Sextile",

        description: "Creates opportunities for two energies to cooperate through conscious effort and openness.",

        themes: ["growth", "openness", "adaptability", "motivation", "connection", "curiosity"],

        interaction: {
            harmony: 80,
            intensity: 45,
            friction: 10,
            growth: 85,
        },

        dynamics: {
            communication: [
                "encourages open and constructive dialogue",
                "helps ideas complement one another",
                "supports learning through conversation",
                "inspires curiosity and collaboration",
            ],

            relationships: [
                "creates opportunities for mutual support",
                "encourages healthy cooperation",
                "strengthens trust through shared experiences",
                "allows differences to become complementary",
            ],

            work: [
                "supports teamwork and collaboration",
                "helps recognize new possibilities",
                "encourages creative problem-solving",
                "allows skills to develop naturally",
            ],

            wellbeing: [
                "benefits from continuous learning",
                "supports gradual personal development",
                "encourages balanced progress without unnecessary pressure",
            ],
        },

        opportunities: [
            "develop new talents",
            "build supportive relationships",
            "recognize opportunities for growth",
            "expand abilities through cooperation",
        ],

        challenges: [
            "overlooking available opportunities",
            "waiting instead of taking initiative",
            "becoming comfortable without continued growth",
            "underestimating personal potential",
        ],

        guidance: {
            embrace: [
                "remain open to new experiences",
                "act on opportunities when they appear",
                "build on existing strengths",
            ],

            avoid: [
                "assuming progress will happen automatically",
                "ignoring helpful connections",
                "hesitating when action is needed",
            ],
        },

        keywords: ["opportunity", "cooperation", "growth", "potential", "support", "development"],
    },
    trine: {
        id: "trine",

        displayName: "Trine",

        description: "Allows two energies to cooperate effortlessly, creating natural flow, stability and confidence.",

        themes: ["clarity", "stability", "confidence", "ease", "balance", "flow"],

        interaction: {
            harmony: 100,
            intensity: 60,
            friction: 5,
            growth: 70,
        },

        dynamics: {
            communication: [
                "encourages natural understanding",
                "allows ideas to flow easily",
                "supports honest and effortless expression",
                "reduces unnecessary misunderstandings",
            ],

            relationships: [
                "creates trust naturally",
                "supports emotional and practical harmony",
                "encourages mutual appreciation",
                "helps relationships develop with ease",
            ],

            work: [
                "supports consistent productivity",
                "allows strengths to complement one another",
                "creates stable progress",
                "encourages confidence in natural abilities",
            ],

            wellbeing: [
                "promotes inner balance",
                "supports sustainable habits",
                "creates a sense of ease and confidence",
            ],
        },

        opportunities: [
            "build lasting confidence",
            "develop natural talents",
            "maintain healthy balance",
            "create stable long-term success",
        ],

        challenges: [
            "taking strengths for granted",
            "avoiding necessary challenges",
            "becoming overly comfortable",
            "missing opportunities for further growth",
        ],

        guidance: {
            embrace: [
                "trust your natural abilities",
                "share your strengths with others",
                "use stability as a foundation for growth",
            ],

            avoid: ["becoming complacent", "assuming success requires no effort", "resisting meaningful challenges"],
        },

        keywords: ["flow", "harmony", "ease", "stability", "confidence", "support"],
    },
    square: {
        id: "square",

        displayName: "Square",

        description:
            "Creates dynamic tension between two energies, encouraging growth through challenge, adjustment and perseverance.",

        themes: ["challenge", "motivation", "hidden_tension", "desire_for_progress", "resilience", "discipline"],

        interaction: {
            harmony: 20,
            intensity: 90,
            friction: 100,
            growth: 100,
        },

        dynamics: {
            communication: [
                "reveals differences in perspective",
                "encourages honest conversations through disagreement",
                "requires patience and active listening",
                "can create productive debate",
            ],

            relationships: [
                "highlights incompatible needs",
                "encourages compromise and mutual understanding",
                "strengthens relationships through shared effort",
                "requires respect for different approaches",
            ],

            work: [
                "reveals obstacles that require creative solutions",
                "builds resilience through persistence",
                "encourages continuous improvement",
                "turns setbacks into learning opportunities",
            ],

            wellbeing: [
                "benefits from healthy stress management",
                "requires balance between effort and recovery",
                "develops resilience through consistent practice",
            ],
        },

        opportunities: [
            "develop resilience",
            "strengthen discipline",
            "discover new solutions",
            "grow through meaningful challenges",
        ],

        challenges: [
            "frustration when progress feels slow",
            "reacting impulsively under pressure",
            "resisting necessary change",
            "becoming discouraged by obstacles",
        ],

        guidance: {
            embrace: [
                "view challenges as opportunities to grow",
                "respond thoughtfully rather than react impulsively",
                "develop patience and persistence",
            ],

            avoid: [
                "avoiding difficult situations",
                "forcing immediate solutions",
                "seeing setbacks as permanent failures",
            ],
        },

        keywords: ["friction", "challenge", "growth", "resilience", "discipline", "adjustment"],
    },
    opposition: {
        id: "opposition",

        displayName: "Opposition",

        description: "Creates awareness through polarity, encouraging balance between two complementary energies.",

        themes: ["reflection", "connection", "hidden_tension", "balance", "awareness", "adaptability"],

        interaction: {
            harmony: 40,
            intensity: 85,
            friction: 80,
            growth: 95,
        },

        dynamics: {
            communication: [
                "reveals contrasting perspectives",
                "encourages listening as much as speaking",
                "helps develop broader understanding",
                "requires openness to different viewpoints",
            ],

            relationships: [
                "highlights complementary strengths",
                "encourages mutual understanding",
                "requires healthy compromise",
                "creates opportunities through cooperation",
            ],

            work: [
                "balances different priorities",
                "encourages collaboration between contrasting approaches",
                "helps identify blind spots",
                "supports better decision-making through perspective",
            ],

            wellbeing: [
                "benefits from maintaining balance",
                "requires awareness of competing needs",
                "supports personal growth through self-reflection",
            ],
        },

        opportunities: [
            "develop greater self-awareness",
            "learn from different perspectives",
            "build stronger partnerships",
            "find balance between opposing needs",
        ],

        challenges: [
            "projecting personal issues onto others",
            "seeing situations as either-or",
            "difficulty finding compromise",
            "feeling pulled in opposite directions",
        ],

        guidance: {
            embrace: [
                "seek balance instead of choosing extremes",
                "learn from opposing perspectives",
                "recognize that both energies have value",
            ],

            avoid: [
                "forcing one side to dominate",
                "avoiding difficult conversations",
                "seeing differences as incompatibility",
            ],
        },

        keywords: ["polarity", "balance", "reflection", "awareness", "partnership", "integration"],
    },
};
