import { Planet } from "../astro/types";

/**
 * Canonical resource keys — what a purchase is *of*.
 *
 * One builder per feature, because the string a debit writes and the string a later
 * access check reads must be the same one. Two call sites formatting a date or joining
 * an id would eventually disagree, and the failure would be silent: the reader pays
 * again for something they already own.
 */
export const creditKeys = {
    dailyInsight: (date: string) => date,
    moonInsight: (date: string) => date,

    /**
     * One planet on one day — although the writing is not divided that way: a single
     * `planet_insights` row per (user, date) holds every planet's text, written in one
     * request by whoever opens the first of them.
     *
     * Paying per planet rather than per panel is deliberate. A reader who opens Mars
     * asked for Mars, and charging them for nine more they may never look at prices the
     * panel by what it cost us rather than by what they wanted. The other side of that
     * bargain is that the first planet pays for the generation and the rest ride along
     * for the price of a reveal.
     */
    planetInsight: (planet: Planet, date: string) => `${planet}:${date}`,

    /** Ids are UUIDs, so a colon cannot appear inside one and the join is unambiguous. */
    compatibilityDetail: (personId: string, date: string) => `${personId}:${date}`,

    /**
     * The person, with no date in it: adding them is paid once and stays paid for as
     * long as they exist. Deleting and adding again makes a new id, so it is a new
     * purchase — which is the intended behaviour, not an accident of the key.
     */
    compatibilityPerson: (personId: string) => personId,
};
