import { LifeArea } from "../astro";

/**
 * The questions offered before the reader has thought of one.
 *
 * Picked from the day, not written by a model. Two reasons: a suggestion is four words
 * and paying for a generation to produce four words is absurd, and the app already
 * knows which of today's numbers is the one worth asking about.
 *
 * The server chooses WHICH; the client renders the words. Each suggestion is an i18n
 * key the app already has a translation for, so nothing here needs a second translation
 * pipeline and a Czech reader gets Czech chips without the server knowing any Czech.
 */

export interface ChatSuggestion {
    /** Stable, for analytics and for React keys. */
    id: string;
    /** An i18next key the app resolves. */
    key: string;
    /** Interpolation values, already in the app's own vocabulary. */
    params?: Record<string, string>;
}

/** How many the empty state shows. Four fits a phone without scrolling. */
const SUGGESTION_LIMIT = 4;

export interface SuggestionInput {
    scores: Record<LifeArea | "overall", number>;
    /** Today's loudest body for this chart, or null on a day with no aspects at all. */
    dominantPlanet: string | null;
    /** Whether today's horoscope has been written yet. */
    hasHoroscope: boolean;
    /** How many people the reader has saved, and the first one's name. */
    savedPerson: string | null;
}

/**
 * Today's four, best first.
 *
 * Ordered by how likely the reader is to be wondering it: the number that stands out,
 * then what is behind the day, then the two evergreens. Deterministic — the same day
 * produces the same four, so the chips do not reshuffle under a thumb.
 */
export function pickSuggestions(input: SuggestionInput): ChatSuggestion[] {
    const areas: LifeArea[] = ["love", "career", "health", "mood"];

    const lowest = areas.reduce((low, area) => (input.scores[area] < input.scores[low] ? area : low), areas[0]);

    const suggestions: ChatSuggestion[] = [];

    /**
     * Only when it is actually low. On a good day "why is my love energy low" is a
     * question about a premise that is not true, and answering it well means arguing
     * with the chip that asked it.
     */
    if (input.scores[lowest] < 45) {
        suggestions.push({ id: "lowest_area", key: "chat.suggestions.lowestArea", params: { area: lowest } });
    }

    if (input.hasHoroscope) {
        suggestions.push({ id: "explain_today", key: "chat.suggestions.explainToday" });
    }

    if (input.dominantPlanet) {
        suggestions.push({
            id: "dominant_planet",
            key: "chat.suggestions.planet",
            params: { planet: input.dominantPlanet },
        });
    }

    if (input.savedPerson) {
        suggestions.push({
            id: "saved_person",
            key: "chat.suggestions.person",
            params: { name: input.savedPerson },
        });
    }

    // Evergreens, at the back. They fill the list on a day where nothing stands out and
    // are dropped when the day has something better to offer.
    suggestions.push({ id: "focus", key: "chat.suggestions.focus" }, { id: "chart", key: "chat.suggestions.chart" });

    return suggestions.slice(0, SUGGESTION_LIMIT);
}
