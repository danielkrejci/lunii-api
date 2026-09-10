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
     * The whole panel for a day, not one planet. There is a single `planet_insights` row
     * per (user, date) holding every planet's text, so one unlock opens all of them.
     */
    planetInsight: (date: string) => date,

    /** Ids are UUIDs, so a colon cannot appear inside one and the join is unambiguous. */
    compatibilityDetail: (personId: string, date: string) => `${personId}:${date}`,

    /**
     * The client's own send id — which is exactly why a retried POST is free. It is the
     * same key `startTurn` is idempotent on, so the two mechanisms agree without either
     * knowing about the other.
     */
    chatMessage: (clientId: string) => clientId,
};
