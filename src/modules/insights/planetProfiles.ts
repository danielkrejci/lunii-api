import { AstrologicalProfile, Planet } from "../insights";

export const PLANET_PROFILES: Record<Planet, AstrologicalProfile> = {
    sun: {
        id: "sun",

        displayName: "Sun",

        description:
            "Represents identity, vitality, purpose and conscious self-expression. The Sun highlights where confidence and authenticity naturally emerge.",

        themes: ["identity", "confidence", "visibility", "self_expression", "recognition", "motivation"],

        energy: {
            activity: 80,
            emotion: 40,
            intellect: 60,
            spirituality: 40,
        },

        expression: {
            communication: [
                "speaks with confidence",
                "expresses personal opinions openly",
                "naturally inspires others",
            ],

            relationships: ["values honesty", "seeks appreciation", "encourages personal growth"],

            work: ["takes responsibility", "likes meaningful goals", "steps naturally into leadership"],

            wellbeing: ["benefits from purposeful activity", "needs healthy self-expression"],
        },

        opportunities: [
            "show leadership",
            "strengthen confidence",
            "take responsibility",
            "express yourself honestly",
            "make important decisions",
        ],

        challenges: ["ego conflicts", "pride", "need for recognition", "stubbornness"],

        guidance: {
            embrace: ["lead by example", "trust your strengths", "act authentically"],

            avoid: ["seeking approval", "forcing your opinion", "letting pride guide decisions"],
        },

        keywords: ["identity", "ego", "purpose", "leadership", "vitality", "authenticity"],
    },
    moon: {
        id: "moon",

        displayName: "Moon",

        description:
            "Represents emotions, instincts, inner needs and emotional security. The Moon reflects how experiences are processed and felt.",

        themes: [
            "emotion",
            "intuition",
            "reflection",
            "comfort",
            "sensitivity",
            "nostalgia",
            "mood_shift",
            "emotional_need",
        ],

        energy: {
            activity: 30,
            emotion: 100,
            intellect: 35,
            spirituality: 80,
        },

        expression: {
            communication: ["communicates emotionally", "listens carefully", "prefers empathy over logic"],

            relationships: ["creates emotional safety", "shows care through attention", "values closeness"],

            work: ["works best in supportive environments", "needs emotional stability"],

            wellbeing: ["benefits from rest", "needs emotional balance", "values familiar routines"],
        },

        opportunities: [
            "strengthen emotional connections",
            "listen to intuition",
            "slow down",
            "reflect before acting",
            "care for yourself",
        ],

        challenges: ["emotional overwhelm", "holding onto the past", "reacting too personally", "changing moods"],

        guidance: {
            embrace: ["acknowledge your emotions", "trust intuition", "create emotional stability"],

            avoid: ["suppressing feelings", "making impulsive emotional decisions"],
        },

        keywords: ["emotions", "intuition", "security", "nurturing", "instinct", "reflection"],
    },
    mercury: {
        id: "mercury",

        displayName: "Mercury",

        description:
            "Represents thinking, communication, learning and exchanging information. Mercury governs how ideas are formed, shared and understood.",

        themes: [
            "communication",
            "conversation",
            "mental_clarity",
            "analysis",
            "curiosity",
            "adaptability",
            "clarity",
            "overthinking",
            "misunderstanding",
        ],

        energy: {
            activity: 60,
            emotion: 30,
            intellect: 100,
            spirituality: 25,
        },

        expression: {
            communication: ["asks questions", "shares ideas clearly", "enjoys discussion"],

            relationships: ["builds trust through conversation", "values openness", "needs intellectual connection"],

            work: ["learns quickly", "organises information", "solves problems logically"],

            wellbeing: ["benefits from mental stimulation", "needs breaks from information overload"],
        },

        opportunities: [
            "have important conversations",
            "learn something new",
            "organise plans",
            "clarify misunderstandings",
            "share ideas",
        ],

        challenges: ["overthinking", "mental restlessness", "miscommunication", "difficulty focusing"],

        guidance: {
            embrace: ["communicate openly", "stay curious", "verify important information"],

            avoid: ["making assumptions", "jumping to conclusions"],
        },

        keywords: ["communication", "thinking", "learning", "logic", "analysis", "adaptability"],
    },
    venus: {
        id: "venus",

        displayName: "Venus",

        description:
            "Represents love, harmony, attraction, beauty and the ability to build meaningful relationships. Venus governs appreciation, pleasure and emotional connection.",

        themes: ["love", "connection", "attraction", "warmth", "romance", "beauty", "affection", "social_ease"],

        energy: {
            activity: 35,
            emotion: 85,
            intellect: 45,
            spirituality: 55,
        },

        expression: {
            communication: ["speaks kindly", "creates harmony", "prefers diplomacy over conflict"],

            relationships: [
                "expresses affection openly",
                "builds trust through kindness",
                "values emotional closeness",
            ],

            work: ["works well collaboratively", "creates pleasant environments", "values aesthetics and balance"],

            wellbeing: ["benefits from beauty and comfort", "needs healthy relationships"],
        },

        opportunities: [
            "strengthen relationships",
            "show appreciation",
            "build harmony",
            "enjoy creative activities",
            "meet new people",
        ],

        challenges: ["avoiding conflict", "seeking approval", "overindulgence", "becoming emotionally dependent"],

        guidance: {
            embrace: ["show kindness", "invest in relationships", "create beauty around you"],

            avoid: ["people pleasing", "ignoring your own needs"],
        },

        keywords: ["love", "relationships", "beauty", "harmony", "pleasure", "attraction"],
    },
    mars: {
        id: "mars",

        displayName: "Mars",

        description:
            "Represents action, drive, courage and the instinct to pursue goals. Mars governs initiative, determination, competition and the ability to confront challenges directly. It also reveals how anger, frustration and physical energy are expressed.",

        themes: [
            "energy",
            "assertiveness",
            "motivation",
            "desire_for_progress",
            "restlessness",
            "frustration",
            "impulsiveness",
            "conflict",
            "impatience",
        ],

        energy: {
            activity: 100,
            emotion: 35,
            intellect: 40,
            spirituality: 15,
        },

        expression: {
            communication: [
                "speaks directly and confidently",
                "addresses problems without hesitation",
                "prefers honest conversations over diplomacy",
                "can become impatient with indecision",
            ],

            relationships: [
                "shows care through actions rather than words",
                "protects people who matter",
                "values independence and mutual respect",
                "can become competitive or confrontational",
            ],

            work: [
                "takes initiative without waiting for permission",
                "performs well under pressure",
                "enjoys solving difficult challenges",
                "prefers action over lengthy planning",
                "thrives in competitive environments",
            ],

            wellbeing: [
                "benefits from regular physical activity",
                "needs healthy outlets for stress and tension",
                "regains balance through movement and action",
            ],
        },

        opportunities: [
            "take decisive action",
            "start new projects",
            "overcome obstacles",
            "solve long-standing problems",
            "defend your boundaries",
            "show courage",
            "build momentum",
            "turn frustration into progress",
        ],

        challenges: [
            "acting impulsively",
            "unnecessary conflict",
            "impatience",
            "reacting before thinking",
            "burnout from pushing too hard",
            "difficulty slowing down",
        ],

        guidance: {
            embrace: [
                "act with confidence",
                "channel your energy into meaningful goals",
                "face challenges directly",
                "use courage constructively",
                "stay persistent when obstacles appear",
            ],

            avoid: [
                "forcing outcomes",
                "starting unnecessary arguments",
                "letting anger control decisions",
                "making rushed choices",
                "ignoring the need for rest",
            ],
        },

        keywords: ["action", "courage", "initiative", "competition", "determination", "drive"],
    },
    jupiter: {
        id: "jupiter",

        displayName: "Jupiter",

        description:
            "Represents expansion, wisdom, optimism and the pursuit of meaning. Jupiter encourages personal growth, broadens perspective and inspires confidence in future possibilities. It highlights where opportunities arise through learning, exploration and trust.",

        themes: ["optimism", "growth", "possibility", "exploration", "freedom", "hope", "openness"],

        energy: {
            activity: 70,
            emotion: 65,
            intellect: 80,
            spirituality: 90,
        },

        expression: {
            communication: [
                "shares ideas with enthusiasm",
                "encourages and motivates others",
                "offers wisdom and a broader perspective",
                "speaks with optimism and confidence",
            ],

            relationships: [
                "inspires personal growth",
                "values honesty and generosity",
                "supports others without controlling them",
                "builds relationships through trust and shared experiences",
            ],

            work: [
                "sees opportunities where others see limits",
                "thinks strategically and long-term",
                "enjoys learning and teaching",
                "embraces ambitious goals",
                "motivates teams with vision and optimism",
            ],

            wellbeing: [
                "benefits from continual learning",
                "thrives when life feels meaningful",
                "regains energy through travel, exploration or new experiences",
            ],
        },

        opportunities: [
            "expand your horizons",
            "learn something valuable",
            "share your knowledge",
            "embrace new opportunities",
            "take a calculated risk",
            "think beyond immediate limitations",
            "develop a long-term vision",
            "strengthen confidence in your path",
        ],

        challenges: [
            "overconfidence",
            "taking on too much",
            "ignoring practical limitations",
            "overestimating your abilities",
            "making unrealistic promises",
            "expecting quick success",
        ],

        guidance: {
            embrace: [
                "stay curious",
                "invest in personal growth",
                "keep an open mind",
                "share your experience generously",
                "look for opportunities in change",
            ],

            avoid: [
                "becoming complacent",
                "overcommitting yourself",
                "assuming everything will work out without effort",
                "neglecting practical details",
            ],
        },

        keywords: ["growth", "wisdom", "opportunity", "expansion", "optimism", "abundance"],
    },
    saturn: {
        id: "saturn",

        displayName: "Saturn",

        description:
            "Represents discipline, responsibility, structure and long-term commitment. Saturn teaches through patience, persistence and experience, revealing where effort, maturity and resilience are required before lasting success can be achieved.",

        themes: [
            "discipline",
            "responsibility",
            "pressure",
            "restraint",
            "seriousness",
            "fatigue",
            "patience",
            "stability",
        ],

        energy: {
            activity: 45,
            emotion: 30,
            intellect: 75,
            spirituality: 70,
        },

        expression: {
            communication: [
                "speaks thoughtfully and deliberately",
                "prefers facts over speculation",
                "chooses words carefully",
                "communicates with authority and responsibility",
            ],

            relationships: [
                "values loyalty and commitment",
                "builds trust slowly but deeply",
                "shows care through reliability",
                "takes relationships seriously",
            ],

            work: [
                "plans carefully before acting",
                "works consistently toward long-term goals",
                "accepts responsibility willingly",
                "maintains high standards",
                "remains resilient through setbacks",
            ],

            wellbeing: [
                "benefits from routine and structure",
                "builds strength through consistency",
                "needs balance between work and recovery",
            ],
        },

        opportunities: [
            "build solid foundations",
            "develop discipline",
            "take responsibility",
            "complete demanding work",
            "strengthen resilience",
            "establish healthy routines",
            "make steady long-term progress",
        ],

        challenges: [
            "feeling restricted",
            "taking on excessive responsibility",
            "self-criticism",
            "fear of failure",
            "mental or physical exhaustion",
            "becoming overly rigid",
        ],

        guidance: {
            embrace: [
                "be patient with your progress",
                "focus on long-term results",
                "honor your commitments",
                "create sustainable routines",
                "learn from challenges",
            ],

            avoid: [
                "expecting immediate success",
                "being overly harsh on yourself",
                "resisting necessary change",
                "ignoring the need for rest",
            ],
        },

        keywords: ["discipline", "structure", "responsibility", "limits", "patience", "mastery"],
    },
    uranus: {
        id: "uranus",

        displayName: "Uranus",

        description:
            "Represents innovation, change, freedom and awakening. Uranus disrupts established patterns, encourages independent thinking and inspires breakthroughs that lead to personal evolution. It reveals where liberation comes through embracing the unexpected.",

        themes: ["change", "surprise", "rebellion", "instability", "breakthrough", "independence", "unpredictability"],

        energy: {
            activity: 80,
            emotion: 35,
            intellect: 90,
            spirituality: 70,
        },

        expression: {
            communication: [
                "introduces original ideas",
                "questions established assumptions",
                "encourages independent thinking",
                "speaks honestly, even when opinions are unconventional",
            ],

            relationships: [
                "values freedom and authenticity",
                "needs personal space",
                "prefers relationships built on equality",
                "dislikes possessiveness and unnecessary restrictions",
            ],

            work: [
                "embraces innovation and experimentation",
                "finds unconventional solutions",
                "adapts quickly to change",
                "challenges outdated systems",
                "thrives in dynamic environments",
            ],

            wellbeing: [
                "benefits from variety and new experiences",
                "needs intellectual stimulation",
                "regains energy through change and exploration",
            ],
        },

        opportunities: [
            "embrace positive change",
            "break outdated habits",
            "discover innovative solutions",
            "gain a fresh perspective",
            "express your individuality",
            "adapt to unexpected opportunities",
            "create meaningful breakthroughs",
        ],

        challenges: [
            "acting unpredictably",
            "resisting stability",
            "making impulsive changes",
            "rebelling without purpose",
            "difficulty committing",
            "feeling restless or disconnected",
        ],

        guidance: {
            embrace: [
                "stay open to new possibilities",
                "think independently",
                "welcome necessary change",
                "allow yourself to evolve",
                "challenge limitations constructively",
            ],

            avoid: [
                "creating chaos without direction",
                "rejecting tradition automatically",
                "making sudden decisions without reflection",
                "confusing freedom with avoidance of responsibility",
            ],
        },

        keywords: ["innovation", "freedom", "change", "awakening", "rebellion", "originality"],
    },
    neptune: {
        id: "neptune",

        displayName: "Neptune",

        description:
            "Represents imagination, spirituality, compassion and the unseen dimensions of life. Neptune dissolves boundaries, inspires creativity and intuition, but can also blur reality through illusion, confusion or escapism.",

        themes: [
            "dreaminess",
            "intuition",
            "confusion",
            "idealism",
            "fantasy",
            "escapism",
            "longing",
            "blurred_boundaries",
        ],

        energy: {
            activity: 20,
            emotion: 85,
            intellect: 40,
            spirituality: 100,
        },

        expression: {
            communication: [
                "speaks with empathy and sensitivity",
                "expresses ideas through symbolism and imagination",
                "communicates intuitively rather than logically",
                "can leave things open to interpretation",
            ],

            relationships: [
                "forms deep emotional and spiritual connections",
                "shows compassion and forgiveness",
                "sees the best in others",
                "may idealize people or overlook red flags",
            ],

            work: [
                "thrives in creative and inspiring environments",
                "approaches problems intuitively",
                "is motivated by purpose rather than recognition",
                "prefers meaningful work over routine tasks",
            ],

            wellbeing: [
                "benefits from solitude and reflection",
                "needs time to reconnect with inner peace",
                "finds balance through creativity, meditation or nature",
            ],
        },

        opportunities: [
            "strengthen your intuition",
            "explore your creativity",
            "connect with your inner world",
            "practice compassion",
            "find inspiration in unexpected places",
            "approach situations with empathy",
            "see beyond surface appearances",
        ],

        challenges: [
            "confusion",
            "wishful thinking",
            "avoiding reality",
            "idealizing people or situations",
            "unclear boundaries",
            "losing focus on practical matters",
        ],

        guidance: {
            embrace: [
                "trust your intuition while staying grounded",
                "express your creativity",
                "cultivate compassion",
                "allow time for reflection",
                "seek meaning beyond material success",
            ],

            avoid: [
                "escaping difficult situations",
                "ignoring reality",
                "making decisions based solely on hope",
                "sacrificing your boundaries for others",
            ],
        },

        keywords: ["spirituality", "imagination", "intuition", "illusion", "compassion", "dreams"],
    },
    pluto: {
        id: "pluto",

        displayName: "Pluto",

        description:
            "Represents transformation, power and profound inner change. Pluto exposes what is hidden, challenges attachments and initiates deep psychological growth. It reveals where endings become beginnings, encouraging resilience through release, renewal and personal evolution.",

        themes: [
            "transformation",
            "obsession",
            "emotional_depth",
            "power",
            "control",
            "release",
            "inner_shift",
            "hidden_tension",
        ],

        energy: {
            activity: 50,
            emotion: 90,
            intellect: 70,
            spirituality: 90,
        },

        expression: {
            communication: [
                "speaks with intensity and purpose",
                "asks questions that uncover deeper truths",
                "communicates honestly about difficult subjects",
                "prefers meaningful conversations over small talk",
            ],

            relationships: [
                "forms deep emotional bonds",
                "values trust and loyalty above appearances",
                "encourages honesty and vulnerability",
                "can become protective or possessive when trust is threatened",
            ],

            work: [
                "thrives during periods of change",
                "uncovers hidden problems and root causes",
                "handles crisis with determination",
                "drives meaningful transformation",
                "remains focused until goals are achieved",
            ],

            wellbeing: [
                "benefits from emotional honesty",
                "grows through self-reflection",
                "needs healthy ways to release emotional tension",
            ],
        },

        opportunities: [
            "embrace personal transformation",
            "release what no longer serves you",
            "face difficult truths",
            "heal emotional wounds",
            "rebuild stronger foundations",
            "develop inner resilience",
            "discover hidden strengths",
        ],

        challenges: [
            "power struggles",
            "obsessive thinking",
            "fear of change",
            "holding onto the past",
            "difficulty letting go",
            "suppressing deep emotions",
        ],

        guidance: {
            embrace: [
                "welcome transformation",
                "practice emotional honesty",
                "let go of unhealthy attachments",
                "focus on long-term healing",
                "use your influence responsibly",
            ],

            avoid: [
                "trying to control everything",
                "dwelling on resentment",
                "resisting necessary endings",
                "manipulating people or situations",
            ],
        },

        keywords: ["transformation", "power", "shadow", "renewal", "crisis", "rebirth"],
    },
};
