import { RelationshipRule, TransitRule } from "./types";

export const RELATIONSHIP_RULES: RelationshipRule[] = [
    //
    // MOON + MOON
    //
    {
        planetA: "moon",
        planetB: "moon",
        aspect: "conjunction",
        impact: 10,
        importance: 2.0,
        category: "emotional",
        title: "Emotional Soulmates",
        description:
            "You instinctively understand each other's emotions. There is a deep sense of familiarity, comfort and emotional safety.",
    },
    {
        planetA: "moon",
        planetB: "moon",
        aspect: "trine",
        impact: 9,
        importance: 2.0,
        category: "emotional",
        title: "Natural Emotional Harmony",
        description:
            "Your emotional needs align naturally. Supporting one another feels effortless and emotionally fulfilling.",
    },
    {
        planetA: "moon",
        planetB: "moon",
        aspect: "sextile",
        impact: 8,
        importance: 1.9,
        category: "emotional",
        title: "Supportive Emotional Bond",
        description:
            "You easily understand how the other person feels and naturally create emotional stability together.",
    },
    {
        planetA: "moon",
        planetB: "moon",
        aspect: "square",
        impact: -8,
        importance: 2.0,
        category: "emotional",
        title: "Clashing Emotional Needs",
        description:
            "Your emotional reactions are often very different, making misunderstandings more likely unless both partners stay patient.",
    },
    {
        planetA: "moon",
        planetB: "moon",
        aspect: "opposition",
        impact: -7,
        importance: 1.9,
        category: "emotional",
        title: "Opposite Emotional Styles",
        description:
            "You often experience the same situations very differently. Mutual understanding requires conscious effort.",
    },

    //
    // MOON + VENUS
    //
    {
        planetA: "moon",
        planetB: "venus",
        aspect: "conjunction",
        impact: 10,
        importance: 2.0,
        category: "emotional",
        title: "Deep Emotional Affection",
        description:
            "This is one of the strongest indicators of warmth, tenderness and genuine emotional care in a relationship.",
    },
    {
        planetA: "moon",
        planetB: "venus",
        aspect: "trine",
        impact: 10,
        importance: 2.0,
        category: "emotional",
        title: "Natural Emotional Harmony",
        description:
            "Affection, kindness and emotional understanding flow naturally between you, making the relationship feel safe and effortless.",
    },
    {
        planetA: "moon",
        planetB: "venus",
        aspect: "sextile",
        impact: 8,
        importance: 1.9,
        category: "emotional",
        title: "Easy Affection",
        description:
            "Showing care and appreciation feels natural. Emotional closeness develops with very little effort.",
    },
    {
        planetA: "moon",
        planetB: "venus",
        aspect: "square",
        impact: -7,
        importance: 2.0,
        category: "emotional",
        title: "Different Emotional Expectations",
        description: "One person's emotional needs may not always match the other's way of expressing affection.",
    },
    {
        planetA: "moon",
        planetB: "venus",
        aspect: "opposition",
        impact: -6,
        importance: 1.9,
        category: "emotional",
        title: "Love Needs Balance",
        description:
            "There is genuine attraction, but emotional expectations may easily become uneven without open communication.",
    },

    //
    // SUN + MOON
    //
    {
        planetA: "sun",
        planetB: "moon",
        aspect: "conjunction",
        impact: 10,
        importance: 2.0,
        category: "emotional",
        title: "Complete Understanding",
        description:
            "Identity and emotions naturally complement each other, creating one of the strongest foundations for a lasting relationship.",
    },
    {
        planetA: "sun",
        planetB: "moon",
        aspect: "trine",
        impact: 9,
        importance: 2.0,
        category: "emotional",
        title: "Balanced Personalities",
        description: "Your personalities and emotional worlds support each other with very little friction.",
    },
    {
        planetA: "sun",
        planetB: "moon",
        aspect: "sextile",
        impact: 8,
        importance: 1.8,
        category: "emotional",
        title: "Mutual Support",
        description: "You naturally encourage each other while respecting emotional differences.",
    },
    {
        planetA: "sun",
        planetB: "moon",
        aspect: "square",
        impact: -8,
        importance: 2.0,
        category: "emotional",
        title: "Emotional Misunderstandings",
        description:
            "Personal goals and emotional reactions don't always align, which can lead to recurring misunderstandings.",
    },
    {
        planetA: "sun",
        planetB: "moon",
        aspect: "opposition",
        impact: -7,
        importance: 1.9,
        category: "emotional",
        title: "Different Perspectives",
        description:
            "You naturally see situations from different emotional angles. Patience and empathy become especially important.",
    },

    //
    // VENUS + VENUS
    //
    {
        planetA: "venus",
        planetB: "venus",
        aspect: "conjunction",
        impact: 10,
        importance: 1.8,
        category: "chemistry",
        title: "Shared Love Language",
        description: "You express affection in remarkably similar ways, making romance feel natural and balanced.",
    },
    {
        planetA: "venus",
        planetB: "venus",
        aspect: "trine",
        impact: 9,
        importance: 1.8,
        category: "chemistry",
        title: "Romantic Compatibility",
        description: "You appreciate similar things in relationships and naturally enjoy making each other happy.",
    },
    {
        planetA: "venus",
        planetB: "venus",
        aspect: "sextile",
        impact: 8,
        importance: 1.7,
        category: "chemistry",
        title: "Comfortable Romance",
        description: "Affection grows easily and both partners usually feel appreciated and valued.",
    },
    {
        planetA: "venus",
        planetB: "venus",
        aspect: "square",
        impact: -5,
        importance: 1.7,
        category: "chemistry",
        title: "Different Love Languages",
        description:
            "You care about each other but may express affection in different ways, creating occasional frustration.",
    },
    {
        planetA: "venus",
        planetB: "venus",
        aspect: "opposition",
        impact: -4,
        importance: 1.6,
        category: "chemistry",
        title: "Balancing Expectations",
        description: "Romantic attraction is present, but expectations around love and affection may differ.",
    },
    //
    //
    // MERCURY + MERCURY
    //
    {
        planetA: "mercury",
        planetB: "mercury",
        aspect: "conjunction",
        impact: 9,
        importance: 1.8,
        category: "communication",
        title: "Shared Way of Thinking",
        description:
            "You naturally understand each other's thoughts and communication style. Conversations feel effortless and stimulating.",
    },
    {
        planetA: "mercury",
        planetB: "mercury",
        aspect: "trine",
        impact: 9,
        importance: 1.8,
        category: "communication",
        title: "Effortless Communication",
        description: "Ideas flow easily between you, making collaboration and problem-solving feel natural.",
    },
    {
        planetA: "mercury",
        planetB: "mercury",
        aspect: "sextile",
        impact: 8,
        importance: 1.7,
        category: "communication",
        title: "Easy Conversations",
        description: "You enjoy exchanging ideas and usually find common ground without much effort.",
    },
    {
        planetA: "mercury",
        planetB: "mercury",
        aspect: "square",
        impact: -8,
        importance: 1.8,
        category: "communication",
        title: "Different Thinking Styles",
        description:
            "You may reach completely different conclusions from the same situation, leading to repeated misunderstandings.",
    },
    {
        planetA: "mercury",
        planetB: "mercury",
        aspect: "opposition",
        impact: -7,
        importance: 1.8,
        category: "communication",
        title: "Opposing Opinions",
        description: "Conversations can become debates unless both people genuinely listen to one another.",
    },

    //
    // MERCURY + MOON
    //
    {
        planetA: "mercury",
        planetB: "moon",
        aspect: "conjunction",
        impact: 9,
        importance: 1.8,
        category: "communication",
        title: "Feelings Become Words",
        description: "You naturally understand and verbalize each other's emotions, creating emotional clarity.",
    },
    {
        planetA: "mercury",
        planetB: "moon",
        aspect: "trine",
        impact: 9,
        importance: 1.8,
        category: "communication",
        title: "Emotional Understanding",
        description: "Thoughts and emotions work together smoothly, making communication feel supportive.",
    },
    {
        planetA: "mercury",
        planetB: "moon",
        aspect: "sextile",
        impact: 8,
        importance: 1.7,
        category: "communication",
        title: "Open Emotional Dialogue",
        description: "You usually know how to express feelings without creating unnecessary tension.",
    },
    {
        planetA: "mercury",
        planetB: "moon",
        aspect: "square",
        impact: -7,
        importance: 1.8,
        category: "communication",
        title: "Logic vs Emotions",
        description: "One person may seek practical answers while the other simply wants emotional understanding.",
    },
    {
        planetA: "mercury",
        planetB: "moon",
        aspect: "opposition",
        impact: -7,
        importance: 1.8,
        category: "communication",
        title: "Misread Intentions",
        description: "Words and feelings don't always match, making misunderstandings more likely.",
    },

    //
    // MERCURY + SUN
    //
    {
        planetA: "mercury",
        planetB: "sun",
        aspect: "conjunction",
        impact: 8,
        importance: 1.6,
        category: "communication",
        title: "Shared Vision",
        description: "Your ideas naturally support each other's identity and personal goals.",
    },
    {
        planetA: "mercury",
        planetB: "sun",
        aspect: "trine",
        impact: 8,
        importance: 1.6,
        category: "communication",
        title: "Respectful Communication",
        description: "You value each other's opinions and usually enjoy meaningful discussions.",
    },
    {
        planetA: "mercury",
        planetB: "sun",
        aspect: "sextile",
        impact: 7,
        importance: 1.5,
        category: "communication",
        title: "Constructive Conversations",
        description: "Sharing ideas feels productive and encourages personal growth.",
    },
    {
        planetA: "mercury",
        planetB: "sun",
        aspect: "square",
        impact: -6,
        importance: 1.6,
        category: "communication",
        title: "Communication Friction",
        description: "One person's perspective may unintentionally challenge the other's confidence.",
    },
    {
        planetA: "mercury",
        planetB: "sun",
        aspect: "opposition",
        impact: -6,
        importance: 1.6,
        category: "communication",
        title: "Competing Perspectives",
        description: "You often see situations differently and may struggle to reach agreement.",
    },

    //
    // MERCURY + VENUS
    //
    {
        planetA: "mercury",
        planetB: "venus",
        aspect: "conjunction",
        impact: 8,
        importance: 1.5,
        category: "communication",
        title: "Kind Communication",
        description: "You naturally express appreciation and affection through conversation.",
    },
    {
        planetA: "mercury",
        planetB: "venus",
        aspect: "trine",
        impact: 8,
        importance: 1.5,
        category: "communication",
        title: "Pleasant Conversations",
        description: "You genuinely enjoy talking and spending time together.",
    },
    {
        planetA: "mercury",
        planetB: "venus",
        aspect: "sextile",
        impact: 7,
        importance: 1.5,
        category: "communication",
        title: "Comfortable Dialogue",
        description: "Communication feels easy, warm and emotionally considerate.",
    },
    {
        planetA: "mercury",
        planetB: "venus",
        aspect: "square",
        impact: -5,
        importance: 1.5,
        category: "communication",
        title: "Words Hurt Easily",
        description: "Comments may unintentionally affect feelings more deeply than expected.",
    },
    {
        planetA: "mercury",
        planetB: "venus",
        aspect: "opposition",
        impact: -5,
        importance: 1.5,
        category: "communication",
        title: "Mixed Messages",
        description: "Affection and communication don't always move in the same direction.",
    },

    //
    // MERCURY + MARS
    //
    {
        planetA: "mercury",
        planetB: "mars",
        aspect: "conjunction",
        impact: 4,
        importance: 1.5,
        category: "communication",
        title: "Fast-Paced Discussions",
        description: "Conversations are energetic and stimulating, but can become impulsive if neither slows down.",
    },
    {
        planetA: "mercury",
        planetB: "mars",
        aspect: "trine",
        impact: 8,
        importance: 1.5,
        category: "communication",
        title: "Ideas Into Action",
        description: "You motivate each other to turn plans into reality.",
    },
    {
        planetA: "mercury",
        planetB: "mars",
        aspect: "sextile",
        impact: 7,
        importance: 1.4,
        category: "communication",
        title: "Productive Momentum",
        description: "Planning and execution work well together, making teamwork effective.",
    },
    {
        planetA: "mercury",
        planetB: "mars",
        aspect: "square",
        impact: -9,
        importance: 1.6,
        category: "communication",
        title: "Arguments Escalate Quickly",
        description: "Small disagreements can rapidly become heated if neither person backs down.",
    },
    {
        planetA: "mercury",
        planetB: "mars",
        aspect: "opposition",
        impact: -8,
        importance: 1.6,
        category: "communication",
        title: "Sharp Words",
        description: "Communication can become confrontational, especially under stress or frustration.",
    },
    //
    //
    // VENUS + MARS
    //
    {
        planetA: "venus",
        planetB: "mars",
        aspect: "conjunction",
        impact: 10,
        importance: 2.0,
        category: "chemistry",
        title: "Powerful Physical Attraction",
        description:
            "One of the strongest indicators of romantic and physical chemistry. Attraction feels immediate and difficult to ignore.",
    },
    {
        planetA: "venus",
        planetB: "mars",
        aspect: "trine",
        impact: 9,
        importance: 2.0,
        category: "chemistry",
        title: "Natural Romantic Chemistry",
        description:
            "Affection and desire flow together naturally, creating effortless romantic and physical connection.",
    },
    {
        planetA: "venus",
        planetB: "mars",
        aspect: "sextile",
        impact: 8,
        importance: 1.8,
        category: "chemistry",
        title: "Playful Attraction",
        description: "Romance develops easily and both partners naturally encourage intimacy and affection.",
    },
    {
        planetA: "venus",
        planetB: "mars",
        aspect: "square",
        impact: -3,
        importance: 1.9,
        category: "chemistry",
        title: "Passionate but Volatile",
        description:
            "Strong attraction exists, but differences in desire or timing can easily create tension and frustration.",
    },
    {
        planetA: "venus",
        planetB: "mars",
        aspect: "opposition",
        impact: 2,
        importance: 1.9,
        category: "chemistry",
        title: "Magnetic Attraction",
        description:
            "Powerful attraction often comes with noticeable differences. Passion is high, but balance requires maturity.",
    },

    //
    // SUN + VENUS
    //
    {
        planetA: "sun",
        planetB: "venus",
        aspect: "conjunction",
        impact: 10,
        importance: 1.8,
        category: "chemistry",
        title: "Mutual Appreciation",
        description: "One partner naturally admires the other, creating warmth, affection and lasting attraction.",
    },
    {
        planetA: "sun",
        planetB: "venus",
        aspect: "trine",
        impact: 9,
        importance: 1.8,
        category: "chemistry",
        title: "Easy Romance",
        description: "Affection feels natural and both partners enjoy making each other happy.",
    },
    {
        planetA: "sun",
        planetB: "venus",
        aspect: "sextile",
        impact: 8,
        importance: 1.7,
        category: "chemistry",
        title: "Warm Connection",
        description: "Kindness and appreciation create a comfortable and supportive romantic atmosphere.",
    },
    {
        planetA: "sun",
        planetB: "venus",
        aspect: "square",
        impact: -4,
        importance: 1.7,
        category: "chemistry",
        title: "Different Romantic Priorities",
        description: "Affection is present, but expectations about love and appreciation don't always align.",
    },
    {
        planetA: "sun",
        planetB: "venus",
        aspect: "opposition",
        impact: -3,
        importance: 1.7,
        category: "chemistry",
        title: "Balancing Love and Identity",
        description: "You care about each other, but personal priorities sometimes compete with the relationship.",
    },

    //
    // SUN + MARS
    //
    {
        planetA: "sun",
        planetB: "mars",
        aspect: "conjunction",
        impact: 7,
        importance: 1.7,
        category: "chemistry",
        title: "Shared Drive",
        description:
            "You energize each other and enjoy pursuing goals together, although competition may occasionally appear.",
    },
    {
        planetA: "sun",
        planetB: "mars",
        aspect: "trine",
        impact: 8,
        importance: 1.7,
        category: "chemistry",
        title: "Motivating Partnership",
        description: "Your energy levels complement each other, making teamwork feel natural.",
    },
    {
        planetA: "sun",
        planetB: "mars",
        aspect: "sextile",
        impact: 7,
        importance: 1.6,
        category: "chemistry",
        title: "Healthy Momentum",
        description: "You encourage each other to take action without creating unnecessary pressure.",
    },
    {
        planetA: "sun",
        planetB: "mars",
        aspect: "square",
        impact: -8,
        importance: 1.8,
        category: "chemistry",
        title: "Competitive Energy",
        description: "Both people may want to lead, making conflicts around control or initiative more likely.",
    },
    {
        planetA: "sun",
        planetB: "mars",
        aspect: "opposition",
        impact: -7,
        importance: 1.8,
        category: "chemistry",
        title: "Power Struggles",
        description:
            "The relationship contains strong energy but can easily slip into unnecessary arguments or competition.",
    },

    //
    // MARS + MARS
    //
    {
        planetA: "mars",
        planetB: "mars",
        aspect: "conjunction",
        impact: 7,
        importance: 1.7,
        category: "chemistry",
        title: "Shared Energy",
        description: "You naturally understand each other's drive and motivation, although neither likes backing down.",
    },
    {
        planetA: "mars",
        planetB: "mars",
        aspect: "trine",
        impact: 9,
        importance: 1.8,
        category: "chemistry",
        title: "Working as a Team",
        description:
            "Your ambitions and energy levels complement one another, making it easy to move toward shared goals.",
    },
    {
        planetA: "mars",
        planetB: "mars",
        aspect: "sextile",
        impact: 8,
        importance: 1.7,
        category: "chemistry",
        title: "Balanced Initiative",
        description: "Both partners naturally motivate each other while respecting personal independence.",
    },
    {
        planetA: "mars",
        planetB: "mars",
        aspect: "square",
        impact: -10,
        importance: 1.9,
        category: "chemistry",
        title: "Constant Competition",
        description: "Both people are likely to push their own agenda, making frequent clashes difficult to avoid.",
    },
    {
        planetA: "mars",
        planetB: "mars",
        aspect: "opposition",
        impact: -8,
        importance: 1.8,
        category: "chemistry",
        title: "Opposing Drives",
        description: "You may constantly pull in opposite directions, especially when making decisions together.",
    },
    //
    //
    // JUPITER + SUN
    //
    {
        planetA: "jupiter",
        planetB: "sun",
        aspect: "conjunction",
        impact: 8,
        importance: 1.3,
        category: "longTerm",
        title: "Shared Growth",
        description:
            "You inspire each other to grow, explore new opportunities and maintain an optimistic outlook together.",
    },
    {
        planetA: "jupiter",
        planetB: "sun",
        aspect: "trine",
        impact: 9,
        importance: 1.3,
        category: "longTerm",
        title: "Expanding Together",
        description: "Both partners naturally encourage confidence, ambition and long-term development.",
    },
    {
        planetA: "jupiter",
        planetB: "sun",
        aspect: "sextile",
        impact: 8,
        importance: 1.2,
        category: "longTerm",
        title: "Healthy Optimism",
        description: "You motivate one another without creating unnecessary pressure.",
    },
    {
        planetA: "jupiter",
        planetB: "sun",
        aspect: "square",
        impact: -3,
        importance: 1.2,
        category: "longTerm",
        title: "Different Priorities",
        description: "Optimism is present, but your expectations for growth may not always align.",
    },
    {
        planetA: "jupiter",
        planetB: "sun",
        aspect: "opposition",
        impact: -2,
        importance: 1.2,
        category: "longTerm",
        title: "Balancing Expectations",
        description: "You encourage each other, but sometimes expect different things from the relationship.",
    },

    //
    // JUPITER + MOON
    //
    {
        planetA: "jupiter",
        planetB: "moon",
        aspect: "conjunction",
        impact: 9,
        importance: 1.4,
        category: "emotional",
        title: "Emotional Generosity",
        description: "Warmth, kindness and emotional encouragement naturally strengthen your connection.",
    },
    {
        planetA: "jupiter",
        planetB: "moon",
        aspect: "trine",
        impact: 9,
        importance: 1.4,
        category: "emotional",
        title: "Positive Emotional Bond",
        description: "Supporting each other emotionally feels easy and uplifting.",
    },
    {
        planetA: "jupiter",
        planetB: "moon",
        aspect: "sextile",
        impact: 8,
        importance: 1.3,
        category: "emotional",
        title: "Optimistic Together",
        description: "You naturally help each other recover from emotional setbacks.",
    },
    {
        planetA: "jupiter",
        planetB: "moon",
        aspect: "square",
        impact: -3,
        importance: 1.3,
        category: "emotional",
        title: "Emotional Excess",
        description: "One partner may unintentionally overlook the other's emotional needs.",
    },
    {
        planetA: "jupiter",
        planetB: "moon",
        aspect: "opposition",
        impact: -2,
        importance: 1.3,
        category: "emotional",
        title: "Different Emotional Expectations",
        description: "Support is present, but emotional priorities may occasionally diverge.",
    },

    //
    // SATURN + SUN
    //
    {
        planetA: "saturn",
        planetB: "sun",
        aspect: "conjunction",
        impact: 7,
        importance: 1.7,
        category: "trust",
        title: "Serious Commitment",
        description:
            "This aspect encourages responsibility, loyalty and a willingness to build something lasting together.",
    },
    {
        planetA: "saturn",
        planetB: "sun",
        aspect: "trine",
        impact: 9,
        importance: 1.8,
        category: "trust",
        title: "Reliable Partnership",
        description: "You naturally support each other's long-term goals while creating stability and mutual respect.",
    },
    {
        planetA: "saturn",
        planetB: "sun",
        aspect: "sextile",
        impact: 8,
        importance: 1.7,
        category: "trust",
        title: "Stable Foundation",
        description: "Trust develops steadily through consistency, patience and reliability.",
    },
    {
        planetA: "saturn",
        planetB: "sun",
        aspect: "square",
        impact: -8,
        importance: 1.8,
        category: "trust",
        title: "Feeling Restricted",
        description: "One partner may unintentionally limit or criticize the other's self-expression.",
    },
    {
        planetA: "saturn",
        planetB: "sun",
        aspect: "opposition",
        impact: -8,
        importance: 1.8,
        category: "trust",
        title: "Pressure and Responsibility",
        description:
            "The relationship may feel heavy unless both partners learn to balance responsibility with encouragement.",
    },

    //
    // SATURN + MOON
    //
    {
        planetA: "saturn",
        planetB: "moon",
        aspect: "conjunction",
        impact: 6,
        importance: 1.8,
        category: "trust",
        title: "Emotional Maturity",
        description:
            "The relationship encourages emotional responsibility, although it may sometimes feel serious or demanding.",
    },
    {
        planetA: "saturn",
        planetB: "moon",
        aspect: "trine",
        impact: 9,
        importance: 1.9,
        category: "trust",
        title: "Lasting Emotional Stability",
        description: "One of the strongest indicators of emotional reliability and long-term commitment.",
    },
    {
        planetA: "saturn",
        planetB: "moon",
        aspect: "sextile",
        impact: 8,
        importance: 1.8,
        category: "trust",
        title: "Dependable Support",
        description: "You naturally create a relationship where both partners feel secure and supported.",
    },
    {
        planetA: "saturn",
        planetB: "moon",
        aspect: "square",
        impact: -9,
        importance: 2.0,
        category: "trust",
        title: "Emotional Distance",
        description: "Emotional needs may feel restricted, making openness harder without conscious effort.",
    },
    {
        planetA: "saturn",
        planetB: "moon",
        aspect: "opposition",
        impact: -10,
        importance: 2.0,
        category: "trust",
        title: "Emotional Burden",
        description:
            "One of the more difficult synastry aspects, often creating feelings of emotional heaviness or isolation unless both partners actively work on understanding each other.",
    },
    //
    //
    // SATURN + VENUS
    //
    {
        planetA: "saturn",
        planetB: "venus",
        aspect: "conjunction",
        impact: 7,
        importance: 1.7,
        category: "longTerm",
        title: "Committed Love",
        description: "Affection grows steadily over time, creating loyalty, patience and long-term commitment.",
    },
    {
        planetA: "saturn",
        planetB: "venus",
        aspect: "trine",
        impact: 9,
        importance: 1.8,
        category: "longTerm",
        title: "Stable Love",
        description:
            "Love feels dependable and secure. Both partners naturally invest in building a lasting relationship.",
    },
    {
        planetA: "saturn",
        planetB: "venus",
        aspect: "sextile",
        impact: 8,
        importance: 1.7,
        category: "longTerm",
        title: "Reliable Affection",
        description: "The relationship develops steadily through trust, consistency and mutual respect.",
    },
    {
        planetA: "saturn",
        planetB: "venus",
        aspect: "square",
        impact: -7,
        importance: 1.8,
        category: "longTerm",
        title: "Love Feels Restricted",
        description:
            "Affection may sometimes feel limited or difficult to express, requiring patience from both partners.",
    },
    {
        planetA: "saturn",
        planetB: "venus",
        aspect: "opposition",
        impact: -8,
        importance: 1.8,
        category: "longTerm",
        title: "Balancing Duty and Love",
        description: "Responsibility and emotional needs may compete, making compromise essential.",
    },

    //
    // SATURN + MERCURY
    //
    {
        planetA: "saturn",
        planetB: "mercury",
        aspect: "conjunction",
        impact: 7,
        importance: 1.4,
        category: "communication",
        title: "Thoughtful Communication",
        description: "Conversations tend to be serious, practical and focused on solving problems together.",
    },
    {
        planetA: "saturn",
        planetB: "mercury",
        aspect: "trine",
        impact: 8,
        importance: 1.4,
        category: "communication",
        title: "Practical Thinking",
        description: "You naturally help each other think carefully before making important decisions.",
    },
    {
        planetA: "saturn",
        planetB: "mercury",
        aspect: "sextile",
        impact: 7,
        importance: 1.3,
        category: "communication",
        title: "Constructive Discussions",
        description: "Communication is patient, organized and solution-oriented.",
    },
    {
        planetA: "saturn",
        planetB: "mercury",
        aspect: "square",
        impact: -7,
        importance: 1.5,
        category: "communication",
        title: "Critical Conversations",
        description: "Communication may become overly critical or pessimistic if neither partner stays open-minded.",
    },
    {
        planetA: "saturn",
        planetB: "mercury",
        aspect: "opposition",
        impact: -7,
        importance: 1.5,
        category: "communication",
        title: "Communication Barriers",
        description: "Ideas may be misunderstood or dismissed too quickly, creating unnecessary frustration.",
    },

    //
    // JUPITER + VENUS
    //
    {
        planetA: "jupiter",
        planetB: "venus",
        aspect: "conjunction",
        impact: 9,
        importance: 1.5,
        category: "chemistry",
        title: "Joyful Love",
        description: "This aspect brings generosity, optimism and genuine enjoyment of each other's company.",
    },
    {
        planetA: "jupiter",
        planetB: "venus",
        aspect: "trine",
        impact: 9,
        importance: 1.5,
        category: "chemistry",
        title: "Abundant Affection",
        description: "Romance feels light, joyful and naturally rewarding for both partners.",
    },
    {
        planetA: "jupiter",
        planetB: "venus",
        aspect: "sextile",
        impact: 8,
        importance: 1.4,
        category: "chemistry",
        title: "Shared Happiness",
        description: "You easily create enjoyable experiences together and naturally lift each other's mood.",
    },
    {
        planetA: "jupiter",
        planetB: "venus",
        aspect: "square",
        impact: -2,
        importance: 1.3,
        category: "chemistry",
        title: "Different Values",
        description: "You may occasionally disagree about priorities, spending or expectations in the relationship.",
    },
    {
        planetA: "jupiter",
        planetB: "venus",
        aspect: "opposition",
        impact: -1,
        importance: 1.3,
        category: "chemistry",
        title: "Finding Balance",
        description: "Generosity is abundant, but expectations around pleasure and commitment may differ.",
    },

    //
    // JUPITER + MERCURY
    //
    {
        planetA: "jupiter",
        planetB: "mercury",
        aspect: "conjunction",
        impact: 8,
        importance: 1.2,
        category: "communication",
        title: "Inspiring Ideas",
        description: "You motivate each other intellectually and enjoy exploring new perspectives together.",
    },
    {
        planetA: "jupiter",
        planetB: "mercury",
        aspect: "trine",
        impact: 8,
        importance: 1.2,
        category: "communication",
        title: "Big Picture Thinking",
        description: "Conversations naturally focus on possibilities, learning and future plans.",
    },
    {
        planetA: "jupiter",
        planetB: "mercury",
        aspect: "sextile",
        impact: 7,
        importance: 1.2,
        category: "communication",
        title: "Curious Minds",
        description: "You encourage each other to learn, grow and stay open to new ideas.",
    },
    {
        planetA: "jupiter",
        planetB: "mercury",
        aspect: "square",
        impact: -2,
        importance: 1.1,
        category: "communication",
        title: "Different Perspectives",
        description: "One person may focus on details while the other prefers the bigger picture.",
    },
    {
        planetA: "jupiter",
        planetB: "mercury",
        aspect: "opposition",
        impact: -2,
        importance: 1.1,
        category: "communication",
        title: "Conflicting Opinions",
        description: "Healthy debate is possible, but compromise is needed to avoid unnecessary disagreements.",
    },

    //
    // JUPITER + MARS
    //
    {
        planetA: "jupiter",
        planetB: "mars",
        aspect: "conjunction",
        impact: 8,
        importance: 1.3,
        category: "chemistry",
        title: "Adventurous Spirit",
        description: "You inspire each other to take action, explore opportunities and embrace new experiences.",
    },
    {
        planetA: "jupiter",
        planetB: "mars",
        aspect: "trine",
        impact: 9,
        importance: 1.3,
        category: "chemistry",
        title: "Confident Team",
        description: "Together you feel motivated, optimistic and ready to tackle ambitious goals.",
    },
    {
        planetA: "jupiter",
        planetB: "mars",
        aspect: "sextile",
        impact: 8,
        importance: 1.2,
        category: "chemistry",
        title: "Healthy Motivation",
        description: "You naturally encourage each other to move forward and keep improving.",
    },
    {
        planetA: "jupiter",
        planetB: "mars",
        aspect: "square",
        impact: -3,
        importance: 1.2,
        category: "chemistry",
        title: "Overconfidence",
        description: "Both partners may become overly optimistic or take unnecessary risks together.",
    },
    {
        planetA: "jupiter",
        planetB: "mars",
        aspect: "opposition",
        impact: -2,
        importance: 1.2,
        category: "chemistry",
        title: "Different Pace",
        description: "One partner may prefer bold action while the other encourages patience.",
    },

    //
    // JUPITER + SATURN
    //
    {
        planetA: "jupiter",
        planetB: "saturn",
        aspect: "conjunction",
        impact: 6,
        importance: 1.1,
        category: "longTerm",
        title: "Balanced Growth",
        description: "Optimism and responsibility can complement each other when both partners stay flexible.",
    },
    {
        planetA: "jupiter",
        planetB: "saturn",
        aspect: "trine",
        impact: 8,
        importance: 1.2,
        category: "longTerm",
        title: "Building Together",
        description: "This aspect balances expansion with stability, creating strong long-term potential.",
    },
    {
        planetA: "jupiter",
        planetB: "saturn",
        aspect: "sextile",
        impact: 7,
        importance: 1.1,
        category: "longTerm",
        title: "Steady Progress",
        description: "You naturally combine ambition with practical planning.",
    },
    {
        planetA: "jupiter",
        planetB: "saturn",
        aspect: "square",
        impact: -3,
        importance: 1.1,
        category: "longTerm",
        title: "Different Approaches",
        description: "One person may seek growth while the other focuses on caution, creating occasional friction.",
    },
    {
        planetA: "jupiter",
        planetB: "saturn",
        aspect: "opposition",
        impact: -3,
        importance: 1.1,
        category: "longTerm",
        title: "Expansion vs Stability",
        description:
            "Finding the right balance between risk and responsibility becomes an important lesson for the relationship.",
    },
];

export const TRANSIT_RULES: TransitRule[] = [
    // =============================================================================
    // MOON → SUN
    // =============================================================================

    {
        planetA: "moon",
        planetB: "sun",
        aspect: "conjunction",

        impact: 8,
        importance: 1.9,

        category: "emotional",

        title: "Emotional Alignment",

        description:
            "Your emotions and your partner's core personality naturally resonate today, making it easier to understand each other's intentions and feel emotionally connected.",
    },
    {
        planetA: "moon",
        planetB: "sun",
        aspect: "harmonious",

        impact: 8,
        importance: 1.8,

        category: "emotional",

        title: "Hearts in Sync",

        description:
            "Emotional understanding flows naturally today. You are more likely to support one another, communicate with empathy and enjoy a genuine sense of togetherness.",
    },
    {
        planetA: "moon",
        planetB: "sun",
        aspect: "challenging",

        impact: -8,
        importance: 2.0,

        category: "emotional",

        title: "Heart Meets Resistance",

        description:
            "Emotional reactions and personal expectations may fall out of sync today. Patience and active listening help prevent unnecessary misunderstandings.",
    },

    // =============================================================================
    // MOON → MOON
    // =============================================================================

    {
        planetA: "moon",
        planetB: "moon",
        aspect: "conjunction",

        impact: 10,
        importance: 2.0,

        category: "emotional",

        title: "Deep Emotional Bond",

        description:
            "Your emotional rhythms become closely aligned today, creating a powerful sense of comfort, closeness and intuitive understanding.",
    },
    {
        planetA: "moon",
        planetB: "moon",
        aspect: "harmonious",

        impact: 9,
        importance: 2.0,

        category: "emotional",

        title: "Shared Feelings",

        description:
            "Compassion, emotional safety and mutual understanding come naturally today, making it easier to strengthen your emotional connection.",
    },
    {
        planetA: "moon",
        planetB: "moon",
        aspect: "challenging",

        impact: -9,
        importance: 2.0,

        category: "emotional",

        title: "Emotional Crossroads",

        description:
            "Differences in mood or emotional needs may become more noticeable today. Giving each other understanding instead of reacting emotionally will help restore harmony.",
    },

    // =============================================================================
    // MOON → MERCURY
    // =============================================================================

    {
        planetA: "moon",
        planetB: "mercury",
        aspect: "conjunction",

        impact: 8,
        importance: 1.8,

        category: "communication",

        title: "Feelings Find Words",

        description:
            "Today's energy helps emotions and communication work together, making honest conversations easier and more meaningful.",
    },
    {
        planetA: "moon",
        planetB: "mercury",
        aspect: "harmonious",

        impact: 8,
        importance: 1.8,

        category: "communication",

        title: "Open Dialogue",

        description:
            "Thoughts and emotions complement each other today, encouraging productive conversations and genuine mutual understanding.",
    },
    {
        planetA: "moon",
        planetB: "mercury",
        aspect: "challenging",

        impact: -7,
        importance: 1.9,

        category: "communication",

        title: "Mixed Signals",

        description:
            "Emotional reactions may temporarily cloud communication. Slowing down and clarifying intentions helps prevent unnecessary misunderstandings.",
    },

    // =============================================================================
    // MOON → VENUS
    // =============================================================================

    {
        planetA: "moon",
        planetB: "venus",
        aspect: "conjunction",

        impact: 10,
        importance: 2.0,

        category: "love",

        title: "Open Hearts",

        description:
            "Affection flows naturally today. Emotional warmth, tenderness and appreciation strengthen your connection and make it easier to express love.",
    },
    {
        planetA: "moon",
        planetB: "venus",
        aspect: "harmonious",

        impact: 9,
        importance: 1.9,

        category: "love",

        title: "Gentle Affection",

        description:
            "Kindness, emotional support and romantic energy create a peaceful atmosphere where both of you feel valued and understood.",
    },
    {
        planetA: "moon",
        planetB: "venus",
        aspect: "challenging",

        impact: -7,
        importance: 1.9,

        category: "love",

        title: "Tender Hearts",

        description:
            "Emotional sensitivity is stronger today. Small disappointments or unmet expectations may feel larger than they truly are, making reassurance especially important.",
    },

    // =============================================================================
    // MOON → MARS
    // =============================================================================

    {
        planetA: "moon",
        planetB: "mars",
        aspect: "conjunction",

        impact: -3,
        importance: 2.0,

        category: "motivation",

        title: "Emotional Fire",

        description:
            "Passion and emotional intensity are amplified today. This energy can strengthen attraction or trigger impulsive reactions, depending on how it's expressed.",
    },
    {
        planetA: "moon",
        planetB: "mars",
        aspect: "harmonious",

        impact: 8,
        importance: 1.8,

        category: "motivation",

        title: "Shared Momentum",

        description:
            "Emotions fuel positive action today. Working toward shared goals feels energizing and strengthens your sense of partnership.",
    },
    {
        planetA: "moon",
        planetB: "mars",
        aspect: "challenging",

        impact: -10,
        importance: 2.0,

        category: "motivation",

        title: "Short Tempers",

        description:
            "Emotional reactions can escalate quickly today. Giving each other space before responding helps prevent unnecessary conflict and hurt feelings.",
    },

    // =============================================================================
    // MOON → JUPITER
    // =============================================================================

    {
        planetA: "moon",
        planetB: "jupiter",
        aspect: "conjunction",

        impact: 9,
        importance: 1.8,

        category: "emotional",

        title: "Brighter Together",

        description:
            "Optimism and generosity shape today's emotional atmosphere. It's easier to encourage each other and enjoy the relationship without focusing on problems.",
    },
    {
        planetA: "moon",
        planetB: "jupiter",
        aspect: "harmonious",

        impact: 8,
        importance: 1.7,

        category: "emotional",

        title: "Growing Together",

        description:
            "Positive emotions create opportunities for deeper trust, laughter and shared experiences that strengthen your relationship.",
    },
    {
        planetA: "moon",
        planetB: "jupiter",
        aspect: "challenging",

        impact: -5,
        importance: 1.5,

        category: "emotional",

        title: "Too Much, Too Fast",

        description:
            "Optimism can become unrealistic today. Promises, expectations or emotional reactions may be bigger than the situation actually requires.",
    },

    // =============================================================================
    // MOON → SATURN
    // =============================================================================

    {
        planetA: "moon",
        planetB: "saturn",
        aspect: "conjunction",

        impact: -8,
        importance: 2.0,

        category: "emotional",

        title: "Heavy Hearts",

        description:
            "Today's atmosphere feels more serious than usual. Emotional patience and mutual support become essential for maintaining closeness.",
    },
    {
        planetA: "moon",
        planetB: "saturn",
        aspect: "harmonious",

        impact: 8,
        importance: 1.9,

        category: "emotional",

        title: "Steady Foundation",

        description:
            "Emotional maturity and reliability help both of you feel secure. Trust grows through consistency, patience and mutual respect.",
    },
    {
        planetA: "moon",
        planetB: "saturn",
        aspect: "challenging",

        impact: -10,
        importance: 2.0,

        category: "emotional",

        title: "Emotional Distance",

        description:
            "Feelings may seem difficult to express today, leading to temporary distance or misunderstanding. Choosing empathy over criticism helps rebuild connection.",
    },

    // =============================================================================
    // SUN → SUN
    // =============================================================================

    {
        planetA: "sun",
        planetB: "sun",
        aspect: "conjunction",

        impact: 8,
        importance: 1.9,

        category: "motivation",

        title: "Shared Purpose",

        description:
            "Your goals and sense of direction naturally align today. It's easier to support one another and make decisions as a team.",
    },
    {
        planetA: "sun",
        planetB: "sun",
        aspect: "harmonious",

        impact: 9,
        importance: 2.0,

        category: "motivation",

        title: "Brighter Together",

        description:
            "Confidence, encouragement and mutual respect strengthen your partnership. You naturally bring out the best in each other today.",
    },
    {
        planetA: "sun",
        planetB: "sun",
        aspect: "challenging",

        impact: -8,
        importance: 2.0,

        category: "motivation",

        title: "Ego Clash",

        description:
            "Strong opinions or competing priorities may create unnecessary tension. Cooperation becomes easier when neither of you feels the need to prove a point.",
    },

    // =============================================================================
    // SUN → MOON
    // =============================================================================

    {
        planetA: "sun",
        planetB: "moon",
        aspect: "conjunction",

        impact: 8,
        importance: 1.9,

        category: "emotional",

        title: "Heart Illuminated",

        description:
            "Today's energy helps emotions and intentions work together, making it easier to understand what each of you truly needs.",
    },
    {
        planetA: "sun",
        planetB: "moon",
        aspect: "harmonious",

        impact: 9,
        importance: 2.0,

        category: "emotional",

        title: "Inner Balance",

        description:
            "Emotional warmth and genuine understanding create an atmosphere where both of you feel safe, appreciated and emotionally connected.",
    },
    {
        planetA: "sun",
        planetB: "moon",
        aspect: "challenging",

        impact: -8,
        importance: 2.0,

        category: "emotional",

        title: "Unspoken Needs",

        description:
            "One person's intentions may not match the other's emotional expectations today. Honest conversations help prevent unnecessary distance.",
    },

    // =============================================================================
    // SUN → MERCURY
    // =============================================================================

    {
        planetA: "sun",
        planetB: "mercury",
        aspect: "conjunction",

        impact: 8,
        importance: 1.8,

        category: "communication",

        title: "Clear Perspective",

        description:
            "Thoughts and intentions become easier to express today, helping conversations feel direct, honest and productive.",
    },
    {
        planetA: "sun",
        planetB: "mercury",
        aspect: "harmonious",

        impact: 8,
        importance: 1.8,

        category: "communication",

        title: "Shared Vision",

        description:
            "Ideas flow naturally between you, making planning, problem solving and meaningful conversations especially rewarding.",
    },
    {
        planetA: "sun",
        planetB: "mercury",
        aspect: "challenging",

        impact: -7,
        importance: 1.8,

        category: "communication",

        title: "Talking Past Each Other",

        description:
            "Different perspectives may make communication feel frustrating today. Taking time to truly listen helps avoid misunderstandings.",
    },

    // =============================================================================
    // SUN → VENUS
    // =============================================================================

    {
        planetA: "sun",
        planetB: "venus",
        aspect: "conjunction",

        impact: 9,
        importance: 2.0,

        category: "love",

        title: "Radiant Affection",

        description:
            "Love, appreciation and warmth become easier to express today. You naturally notice the qualities you admire in each other, strengthening your emotional connection.",
    },
    {
        planetA: "sun",
        planetB: "venus",
        aspect: "harmonious",

        impact: 9,
        importance: 1.9,

        category: "love",

        title: "Closer Than Usual",

        description:
            "Your relationship benefits from kindness, shared joy and genuine appreciation. Even small moments together feel meaningful today.",
    },
    {
        planetA: "sun",
        planetB: "venus",
        aspect: "challenging",

        impact: -6,
        importance: 1.8,

        category: "love",

        title: "Love Needs Attention",

        description:
            "One of you may seek more affection or appreciation than the other naturally offers today. Small acts of kindness quickly restore emotional balance.",
    },

    // =============================================================================
    // SUN → MARS
    // =============================================================================

    {
        planetA: "sun",
        planetB: "mars",
        aspect: "conjunction",

        impact: 7,
        importance: 1.9,

        category: "motivation",

        title: "Driven Together",

        description:
            "Your combined energy encourages initiative, confidence and taking action together. Shared goals feel exciting and achievable.",
    },
    {
        planetA: "sun",
        planetB: "mars",
        aspect: "harmonious",

        impact: 8,
        importance: 1.8,

        category: "motivation",

        title: "Confident Momentum",

        description:
            "You naturally motivate one another today. Challenges become easier to overcome through teamwork and mutual encouragement.",
    },
    {
        planetA: "sun",
        planetB: "mars",
        aspect: "challenging",

        impact: -9,
        importance: 2.0,

        category: "motivation",

        title: "Power Struggle",

        description:
            "Strong personalities may compete instead of cooperate today. Choosing collaboration over control helps prevent unnecessary conflict.",
    },

    // =============================================================================
    // SUN → JUPITER
    // =============================================================================

    {
        planetA: "sun",
        planetB: "jupiter",
        aspect: "conjunction",

        impact: 8,
        importance: 1.8,

        category: "motivation",

        title: "Limitless Potential",

        description:
            "Optimism and confidence encourage both of you to dream bigger together. Today's energy supports growth, exploration and shared opportunities.",
    },
    {
        planetA: "sun",
        planetB: "jupiter",
        aspect: "harmonious",

        impact: 8,
        importance: 1.7,

        category: "motivation",

        title: "Growing Confidence",

        description:
            "Encouragement flows naturally between you. It's easier to believe in each other's abilities and celebrate shared successes.",
    },
    {
        planetA: "sun",
        planetB: "jupiter",
        aspect: "challenging",

        impact: -5,
        importance: 1.5,

        category: "motivation",

        title: "Bigger Than Reality",

        description:
            "Optimism is high today, but expectations may become unrealistic. Staying grounded helps avoid disappointment later.",
    },

    // =============================================================================
    // SUN → SATURN
    // =============================================================================

    {
        planetA: "sun",
        planetB: "saturn",
        aspect: "conjunction",

        impact: -5,
        importance: 1.9,

        category: "motivation",

        title: "Shared Responsibility",

        description:
            "Today's energy highlights commitment, responsibility and long-term thinking. Working together patiently strengthens your relationship.",
    },
    {
        planetA: "sun",
        planetB: "saturn",
        aspect: "harmonious",

        impact: 7,
        importance: 1.8,

        category: "motivation",

        title: "Built to Last",

        description:
            "Discipline and reliability create a solid foundation today. Trust grows through consistency, responsibility and mutual respect.",
    },
    {
        planetA: "sun",
        planetB: "saturn",
        aspect: "challenging",

        impact: -9,
        importance: 2.0,

        category: "motivation",

        title: "Heavy Expectations",

        description:
            "Pressure, criticism or conflicting responsibilities may temporarily overshadow your connection. Patience and understanding help you move through today's challenges together.",
    },

    // =============================================================================
    // MERCURY → SUN
    // =============================================================================

    {
        planetA: "mercury",
        planetB: "sun",
        aspect: "conjunction",

        impact: 8,
        importance: 1.8,

        category: "communication",

        title: "Shared Clarity",

        description:
            "Ideas flow naturally between you today. Honest conversations and thoughtful decisions strengthen mutual understanding and make cooperation feel effortless.",
    },
    {
        planetA: "mercury",
        planetB: "sun",
        aspect: "harmonious",

        impact: 8,
        importance: 1.7,

        category: "communication",

        title: "Inspired Conversations",

        description:
            "You easily understand each other's intentions and perspectives. It's an excellent day for making plans or resolving lingering questions together.",
    },
    {
        planetA: "mercury",
        planetB: "sun",
        aspect: "challenging",

        impact: -7,
        importance: 1.8,

        category: "communication",

        title: "Misread Intentions",

        description:
            "Good intentions may become lost in the way they're expressed. Clarifying expectations helps prevent unnecessary misunderstandings today.",
    },

    // =============================================================================
    // MERCURY → MOON
    // =============================================================================

    {
        planetA: "mercury",
        planetB: "moon",
        aspect: "conjunction",

        impact: 8,
        importance: 1.9,

        category: "communication",

        title: "Words With Feeling",

        description:
            "Emotions are easier to express openly today. Conversations naturally become more supportive, honest and emotionally meaningful.",
    },
    {
        planetA: "mercury",
        planetB: "moon",
        aspect: "harmonious",

        impact: 8,
        importance: 1.8,

        category: "communication",

        title: "Understanding Comes Easily",

        description:
            "Listening feels just as important as speaking today. Mutual empathy creates space for productive and heartfelt conversations.",
    },
    {
        planetA: "mercury",
        planetB: "moon",
        aspect: "challenging",

        impact: -8,
        importance: 1.9,

        category: "communication",

        title: "Sensitive Conversations",

        description:
            "Words may unintentionally trigger emotional reactions today. Choosing patience over quick responses helps maintain harmony.",
    },

    // =============================================================================
    // MERCURY → MERCURY
    // =============================================================================

    {
        planetA: "mercury",
        planetB: "mercury",
        aspect: "conjunction",

        impact: 9,
        importance: 2.0,

        category: "communication",

        title: "Perfect Understanding",

        description:
            "Your minds naturally operate on the same wavelength today. Communication feels effortless, making collaboration and problem-solving especially rewarding.",
    },
    {
        planetA: "mercury",
        planetB: "mercury",
        aspect: "harmonious",

        impact: 9,
        importance: 1.9,

        category: "communication",

        title: "Mental Harmony",

        description:
            "Ideas flow smoothly between you. It's easy to exchange thoughts, make plans and enjoy stimulating conversations together.",
    },
    {
        planetA: "mercury",
        planetB: "mercury",
        aspect: "challenging",

        impact: -8,
        importance: 2.0,

        category: "communication",

        title: "Crossed Wires",

        description:
            "Different perspectives may lead to unnecessary debates today. Slowing down and making sure you've understood each other prevents confusion.",
    },
    // =============================================================================
    // MERCURY → VENUS
    // =============================================================================

    {
        planetA: "mercury",
        planetB: "venus",
        aspect: "conjunction",

        impact: 8,
        importance: 1.9,

        category: "love",

        title: "Words of Affection",

        description:
            "Kind and thoughtful communication strengthens your emotional connection today. Expressing appreciation feels natural and deeply meaningful.",
    },
    {
        planetA: "mercury",
        planetB: "venus",
        aspect: "harmonious",

        impact: 8,
        importance: 1.8,

        category: "love",

        title: "Easy Romance",

        description:
            "Conversations flow with warmth and charm today. Sharing feelings, compliments or future plans helps deepen your connection.",
    },
    {
        planetA: "mercury",
        planetB: "venus",
        aspect: "challenging",

        impact: -6,
        importance: 1.8,

        category: "love",

        title: "Unspoken Expectations",

        description:
            "One of you may expect more affection or reassurance than the other realizes. Speaking openly prevents unnecessary disappointment.",
    },

    // =============================================================================
    // MERCURY → MARS
    // =============================================================================

    {
        planetA: "mercury",
        planetB: "mars",
        aspect: "conjunction",

        impact: 6,
        importance: 1.9,

        category: "motivation",

        title: "Bold Decisions",

        description:
            "Quick thinking and decisive action help you move forward together today. Just be mindful not to rush important conversations.",
    },
    {
        planetA: "mercury",
        planetB: "mars",
        aspect: "harmonious",

        impact: 8,
        importance: 1.8,

        category: "motivation",

        title: "Focused Action",

        description:
            "Clear communication and shared determination make it easier to solve problems and accomplish goals as a team.",
    },
    {
        planetA: "mercury",
        planetB: "mars",
        aspect: "challenging",

        impact: -9,
        importance: 2.0,

        category: "communication",

        title: "Sharp Words",

        description:
            "Conversations may become impatient or argumentative today. Taking a moment before responding can prevent unnecessary conflict.",
    },

    // =============================================================================
    // MERCURY → JUPITER
    // =============================================================================

    {
        planetA: "mercury",
        planetB: "jupiter",
        aspect: "conjunction",

        impact: 8,
        importance: 1.8,

        category: "communication",

        title: "Big Ideas",

        description:
            "Your conversations naturally expand beyond everyday topics today. It's a great time to dream, learn and make exciting plans together.",
    },
    {
        planetA: "mercury",
        planetB: "jupiter",
        aspect: "harmonious",

        impact: 8,
        importance: 1.7,

        category: "communication",

        title: "Shared Vision",

        description:
            "Optimism and curiosity shape your conversations today, helping both of you discover new possibilities and strengthen your long-term outlook.",
    },
    {
        planetA: "mercury",
        planetB: "jupiter",
        aspect: "challenging",

        impact: -5,
        importance: 1.5,

        category: "communication",

        title: "Too Many Assumptions",

        description:
            "Enthusiasm may lead to overlooking important details today. Double-checking plans helps avoid confusion later.",
    },

    // =============================================================================
    // MERCURY → SATURN
    // =============================================================================

    {
        planetA: "mercury",
        planetB: "saturn",
        aspect: "conjunction",

        impact: -3,
        importance: 1.8,

        category: "communication",

        title: "Serious Discussions",

        description:
            "Today's conversations naturally focus on responsibilities, commitments and long-term decisions. Honest dialogue strengthens trust.",
    },
    {
        planetA: "mercury",
        planetB: "saturn",
        aspect: "harmonious",

        impact: 7,
        importance: 1.8,

        category: "communication",

        title: "Thoughtful Planning",

        description:
            "Careful thinking and practical communication help both of you make solid decisions and build confidence in the future.",
    },
    {
        planetA: "mercury",
        planetB: "saturn",
        aspect: "challenging",

        impact: -8,
        importance: 1.9,

        category: "communication",

        title: "Communication Barriers",

        description:
            "Conversations may feel heavier than usual today. Criticism, silence or stubbornness can create distance unless both of you remain patient and open-minded.",
    },
    // =============================================================================
    // VENUS → SUN
    // =============================================================================

    {
        planetA: "venus",
        planetB: "sun",
        aspect: "conjunction",

        impact: 9,
        importance: 2.0,

        category: "love",

        title: "Magnetic Attraction",

        description:
            "Affection, admiration and appreciation come naturally today. You enjoy being together and easily remind each other what brought you together in the first place.",
    },
    {
        planetA: "venus",
        planetB: "sun",
        aspect: "harmonious",

        impact: 9,
        importance: 1.9,

        category: "love",

        title: "Natural Appreciation",

        description:
            "You naturally notice each other's strengths and express warmth with ease. Small gestures of affection have an even greater impact today.",
    },
    {
        planetA: "venus",
        planetB: "sun",
        aspect: "challenging",

        impact: -6,
        importance: 1.8,

        category: "love",

        title: "Need for Recognition",

        description:
            "One of you may feel overlooked or underappreciated today. Genuine compliments and thoughtful attention help restore emotional balance.",
    },

    // =============================================================================
    // VENUS → MOON
    // =============================================================================

    {
        planetA: "venus",
        planetB: "moon",
        aspect: "conjunction",

        impact: 10,
        importance: 2.0,

        category: "love",

        title: "Heartfelt Affection",

        description:
            "Love and emotions blend beautifully today. Affection feels sincere, comforting and deeply nurturing, strengthening your emotional bond.",
    },
    {
        planetA: "venus",
        planetB: "moon",
        aspect: "harmonious",

        impact: 9,
        importance: 2.0,

        category: "love",

        title: "Emotional Warmth",

        description:
            "Gentleness and emotional support flow naturally between you. It's an ideal day to reconnect through kindness and quality time.",
    },
    {
        planetA: "venus",
        planetB: "moon",
        aspect: "challenging",

        impact: -7,
        importance: 1.9,

        category: "love",

        title: "Fragile Feelings",

        description:
            "Emotional sensitivity is heightened today. Choosing reassurance over criticism helps prevent unnecessary hurt feelings.",
    },

    // =============================================================================
    // VENUS → MERCURY
    // =============================================================================

    {
        planetA: "venus",
        planetB: "mercury",
        aspect: "conjunction",

        impact: 8,
        importance: 1.8,

        category: "communication",

        title: "Sweet Conversations",

        description:
            "Kind words come naturally today. Honest appreciation and thoughtful conversations deepen emotional intimacy.",
    },
    {
        planetA: "venus",
        planetB: "mercury",
        aspect: "harmonious",

        impact: 8,
        importance: 1.8,

        category: "communication",

        title: "Speaking with Kindness",

        description:
            "Communication feels gentle, supportive and encouraging. It's easier to resolve differences while preserving harmony.",
    },
    {
        planetA: "venus",
        planetB: "mercury",
        aspect: "challenging",

        impact: -6,
        importance: 1.8,

        category: "communication",

        title: "Unsaid Feelings",

        description:
            "Important emotions may remain unspoken today. Honest but gentle communication helps avoid unnecessary confusion.",
    },

    // =============================================================================
    // VENUS → VENUS
    // =============================================================================

    {
        planetA: "venus",
        planetB: "venus",
        aspect: "conjunction",

        impact: 10,
        importance: 2.0,

        category: "love",

        title: "Perfect Harmony",

        description:
            "Romantic energy reaches one of its strongest expressions today. Love, attraction and appreciation naturally reinforce your relationship.",
    },
    {
        planetA: "venus",
        planetB: "venus",
        aspect: "harmonious",

        impact: 10,
        importance: 2.0,

        category: "love",

        title: "Romantic Flow",

        description:
            "Affection, intimacy and shared happiness come effortlessly today. It's one of the best energies for enjoying each other's company.",
    },
    {
        planetA: "venus",
        planetB: "venus",
        aspect: "challenging",

        impact: -5,
        importance: 1.8,

        category: "love",

        title: "Different Desires",

        description:
            "You may temporarily express love in different ways today. Recognizing each other's needs helps strengthen the relationship instead of creating distance.",
    },

    // =============================================================================
    // VENUS → MARS
    // =============================================================================

    {
        planetA: "venus",
        planetB: "mars",
        aspect: "conjunction",

        impact: 9,
        importance: 2.0,

        category: "love",

        title: "Magnetic Chemistry",

        description:
            "Attraction, passion and emotional excitement are amplified today. Romance feels vibrant, making it easier to reconnect through affection and shared experiences.",
    },
    {
        planetA: "venus",
        planetB: "mars",
        aspect: "harmonious",

        impact: 9,
        importance: 1.9,

        category: "love",

        title: "Playful Passion",

        description:
            "Romantic and physical chemistry flow naturally today. Shared enthusiasm brings excitement, affection and renewed closeness.",
    },
    {
        planetA: "venus",
        planetB: "mars",
        aspect: "challenging",

        impact: -8,
        importance: 2.0,

        category: "love",

        title: "Passion or Friction",

        description:
            "Strong attraction can easily become impatience or conflict today. Choosing understanding over impulsive reactions keeps the spark alive without unnecessary arguments.",
    },

    // =============================================================================
    // VENUS → JUPITER
    // =============================================================================

    {
        planetA: "venus",
        planetB: "jupiter",
        aspect: "conjunction",

        impact: 9,
        importance: 1.9,

        category: "love",

        title: "Abundant Love",

        description:
            "Generosity, optimism and affection surround your relationship today. It's an excellent time to celebrate each other and create joyful memories together.",
    },
    {
        planetA: "venus",
        planetB: "jupiter",
        aspect: "harmonious",

        impact: 8,
        importance: 1.8,

        category: "love",

        title: "Joyful Connection",

        description:
            "Your relationship benefits from laughter, gratitude and shared optimism. Even ordinary moments feel lighter and more meaningful today.",
    },
    {
        planetA: "venus",
        planetB: "jupiter",
        aspect: "challenging",

        impact: -5,
        importance: 1.6,

        category: "love",

        title: "Love Without Limits",

        description:
            "Good intentions are plentiful today, but expectations or promises may become unrealistic. Keeping things simple helps maintain genuine connection.",
    },

    // =============================================================================
    // VENUS → SATURN
    // =============================================================================

    {
        planetA: "venus",
        planetB: "saturn",
        aspect: "conjunction",

        impact: -3,
        importance: 2.0,

        category: "love",

        title: "Love with Commitment",

        description:
            "Affection takes on a more serious tone today. Commitment, loyalty and reliability become more important than grand romantic gestures.",
    },
    {
        planetA: "venus",
        planetB: "saturn",
        aspect: "harmonious",

        impact: 8,
        importance: 1.9,

        category: "love",

        title: "Lasting Devotion",

        description:
            "Steady affection and emotional maturity strengthen your relationship. Trust grows through consistency, patience and dependable support.",
    },
    {
        planetA: "venus",
        planetB: "saturn",
        aspect: "challenging",

        impact: -9,
        importance: 2.0,

        category: "love",

        title: "Love Put to the Test",

        description:
            "Distance, insecurity or unmet emotional needs may become more noticeable today. Small acts of reassurance and patience help reinforce your connection.",
    },

    // =============================================================================
    // MARS → SUN
    // =============================================================================

    {
        planetA: "mars",
        planetB: "sun",
        aspect: "conjunction",

        impact: 8,
        importance: 2.0,

        category: "motivation",

        title: "Shared Determination",

        description:
            "Your combined energy encourages action, confidence and decisive movement. Working toward a common goal feels motivating and energizing today.",
    },
    {
        planetA: "mars",
        planetB: "sun",
        aspect: "harmonious",

        impact: 8,
        importance: 1.9,

        category: "motivation",

        title: "Strong Team",

        description:
            "You naturally motivate one another to take initiative and overcome challenges. Cooperation feels dynamic without becoming competitive.",
    },
    {
        planetA: "mars",
        planetB: "sun",
        aspect: "challenging",

        impact: -9,
        importance: 2.0,

        category: "motivation",

        title: "Battle of Wills",

        description:
            "Strong personalities may compete for control today. Channeling your energy toward shared goals instead of personal victories prevents unnecessary conflict.",
    },

    // =============================================================================
    // MARS → MOON
    // =============================================================================

    {
        planetA: "mars",
        planetB: "moon",
        aspect: "conjunction",

        impact: -5,
        importance: 2.0,

        category: "emotional",

        title: "Intense Emotions",

        description:
            "Emotions become stronger and more immediate today. Passion can deepen your connection, but impulsive reactions may also surface more easily.",
    },
    {
        planetA: "mars",
        planetB: "moon",
        aspect: "harmonious",

        impact: 8,
        importance: 1.9,

        category: "emotional",

        title: "Courage to Connect",

        description:
            "You feel emotionally brave and willing to address important topics together. Honest vulnerability strengthens your relationship.",
    },
    {
        planetA: "mars",
        planetB: "moon",
        aspect: "challenging",

        impact: -10,
        importance: 2.0,

        category: "emotional",

        title: "Emotional Flashpoint",

        description:
            "Small frustrations can escalate quickly today. Giving each other time to cool down before reacting helps prevent unnecessary arguments.",
    },

    // =============================================================================
    // MARS → MERCURY
    // =============================================================================

    {
        planetA: "mars",
        planetB: "mercury",
        aspect: "conjunction",

        impact: 7,
        importance: 1.9,

        category: "communication",

        title: "Decisive Thinking",

        description:
            "Your conversations become energetic and solution-oriented today. Quick decisions are easier, provided both of you take time to listen.",
    },
    {
        planetA: "mars",
        planetB: "mercury",
        aspect: "harmonious",

        impact: 8,
        importance: 1.8,

        category: "communication",

        title: "Clear Action",

        description:
            "Ideas quickly turn into action today. Planning, problem-solving and making decisions together feels productive and efficient.",
    },
    {
        planetA: "mars",
        planetB: "mercury",
        aspect: "challenging",

        impact: -9,
        importance: 2.0,

        category: "communication",

        title: "Heated Debate",

        description:
            "Discussions can become confrontational today if either of you reacts too quickly. Listening with patience is more effective than trying to win the argument.",
    },

    // =============================================================================
    // MARS → VENUS
    // =============================================================================

    {
        planetA: "mars",
        planetB: "venus",
        aspect: "conjunction",

        impact: 10,
        importance: 2.0,

        category: "love",

        title: "Irresistible Attraction",

        description:
            "Passion and attraction are especially strong today. Emotional closeness and physical chemistry naturally reinforce one another.",
    },
    {
        planetA: "mars",
        planetB: "venus",
        aspect: "harmonious",

        impact: 9,
        importance: 2.0,

        category: "love",

        title: "Spark Rekindled",

        description:
            "Romantic energy feels vibrant and exciting. Spending quality time together strengthens both emotional and physical intimacy.",
    },
    {
        planetA: "mars",
        planetB: "venus",
        aspect: "challenging",

        impact: -8,
        importance: 2.0,

        category: "love",

        title: "Love Under Pressure",

        description:
            "Strong attraction can easily become impatience or jealousy today. Expressing your needs calmly helps preserve both passion and trust.",
    },
    // =============================================================================
    // MARS → MARS
    // =============================================================================

    {
        planetA: "mars",
        planetB: "mars",
        aspect: "conjunction",

        impact: 8,
        importance: 2.0,

        category: "motivation",

        title: "United Force",

        description:
            "Your combined drive is exceptionally strong today. Working toward a shared objective feels energizing, but balancing determination with patience helps avoid unnecessary friction.",
    },
    {
        planetA: "mars",
        planetB: "mars",
        aspect: "harmonious",

        impact: 9,
        importance: 2.0,

        category: "motivation",

        title: "Power in Motion",

        description:
            "You naturally motivate each other to take action. Confidence, teamwork and shared ambition make today's challenges easier to overcome together.",
    },
    {
        planetA: "mars",
        planetB: "mars",
        aspect: "challenging",

        impact: -10,
        importance: 2.0,

        category: "motivation",

        title: "Direct Collision",

        description:
            "Competitive instincts and impatience may surface more easily today. Choosing cooperation over proving who's right helps preserve harmony.",
    },

    // =============================================================================
    // MARS → JUPITER
    // =============================================================================

    {
        planetA: "mars",
        planetB: "jupiter",
        aspect: "conjunction",

        impact: 8,
        importance: 1.8,

        category: "motivation",

        title: "Bold Adventure",

        description:
            "Your shared enthusiasm encourages action, exploration and taking on new opportunities. Confidence grows when you move forward together.",
    },
    {
        planetA: "mars",
        planetB: "jupiter",
        aspect: "harmonious",

        impact: 8,
        importance: 1.8,

        category: "motivation",

        title: "Fearless Progress",

        description:
            "Optimism and determination work hand in hand today. Supporting each other's ambitions strengthens both your confidence and your connection.",
    },
    {
        planetA: "mars",
        planetB: "jupiter",
        aspect: "challenging",

        impact: -6,
        importance: 1.6,

        category: "motivation",

        title: "Running Too Fast",

        description:
            "Excitement may encourage taking unnecessary risks or making promises too quickly. Slowing down helps keep your plans realistic and achievable.",
    },

    // =============================================================================
    // MARS → SATURN
    // =============================================================================

    {
        planetA: "mars",
        planetB: "saturn",
        aspect: "conjunction",

        impact: -4,
        importance: 1.9,

        category: "motivation",

        title: "Measured Strength",

        description:
            "Today's energy asks for patience before action. Progress comes through persistence, careful planning and supporting each other's responsibilities.",
    },
    {
        planetA: "mars",
        planetB: "saturn",
        aspect: "harmonious",

        impact: 8,
        importance: 1.9,

        category: "motivation",

        title: "Steady Resolve",

        description:
            "Discipline and determination work together beautifully today. You can accomplish meaningful goals by combining patience with consistent effort.",
    },
    {
        planetA: "mars",
        planetB: "saturn",
        aspect: "challenging",

        impact: -9,
        importance: 2.0,

        category: "motivation",

        title: "Frustrated Momentum",

        description:
            "It may feel like one of you wants to move forward while the other prefers caution. Respecting each other's pace helps prevent frustration from turning into conflict.",
    },
];
