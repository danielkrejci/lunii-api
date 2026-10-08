import type { profile as profileTable } from "../../db/schema";

type Profile = typeof profileTable.$inferSelect;

/**
 * What the reader may change about themselves, in the shape the update route accepts.
 *
 * The birth place travels as one unit — a name without its coordinates would leave the
 * chart computed from somewhere else than the screen says.
 */
export interface ProfileChanges {
    name?: string;
    gender?: Profile["gender"];
    birthDate?: string;
    /** `HH:mm`, or null for an unknown time. The column holds `HH:mm:ss`. */
    birthTime?: string | null;
    birthPlace?: string;
    birthPlaceLat?: number;
    birthPlaceLng?: number;
    country?: string;
    language?: string;
    relationshipStatus?: string;
    careerStage?: string;
    decisionStyle?: string;
    areasOfInterest?: string[];
    contentPreference?: string;
    beliefLevel?: string;
}

/**
 * How far an edit reaches into what was already written.
 *
 * - `chart`: the birth data moved, so the chart, the signs, every score and every text
 *   built on them are about someone else now.
 * - `wording`: the language, the form of address or the answers that shape the prompt
 *   changed. The scores stand; only the texts are written differently.
 * - `none`: nothing written depends on it — the name, the country, the place's label.
 */
export type ChangeScope = "chart" | "wording" | "none";

const CHART_FIELDS = ["birthDate", "birthTime", "birthPlaceLat", "birthPlaceLng"] as const;

/** Language and gender reach every prompt; the rest reach it through the Reader block. */
const WORDING_FIELDS = [
    "language",
    "gender",
    "relationshipStatus",
    "careerStage",
    "decisionStyle",
    "areasOfInterest",
    "contentPreference",
    "beliefLevel",
] as const;

function sameValue(key: keyof ProfileChanges, stored: Profile, requested: ProfileChanges): boolean {
    const next = requested[key];

    if (key === "birthTime") {
        // The column carries seconds, the request does not.
        return (stored.birthTime?.slice(0, 5) ?? null) === next;
    }

    if (key === "areasOfInterest") {
        // A set, not a list: picking the same three in another order changes nothing.
        const a = [...stored.areasOfInterest].sort();
        const b = [...(next as string[])].sort();

        return a.length === b.length && a.every((value, index) => value === b[index]);
    }

    return stored[key] === next;
}

/**
 * Only the fields that really change, and how far the change reaches.
 *
 * Fields sent with the value they already have are dropped, so a screen saved without
 * an edit costs nothing and rewrites nothing.
 */
export function diffProfile(
    stored: Profile,
    requested: ProfileChanges
): { changed: ProfileChanges; scope: ChangeScope } {
    const changed: Record<string, unknown> = {};

    for (const key of Object.keys(requested) as (keyof ProfileChanges)[]) {
        if (requested[key] !== undefined && !sameValue(key, stored, requested)) {
            changed[key] = requested[key];
        }
    }

    const touched = (fields: readonly string[]) => fields.some((field) => field in changed);

    const scope: ChangeScope = touched(CHART_FIELDS) ? "chart" : touched(WORDING_FIELDS) ? "wording" : "none";

    return { changed: changed as ProfileChanges, scope };
}
