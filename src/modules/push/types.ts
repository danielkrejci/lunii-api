/**
 * The vocabulary of push notifications.
 *
 * Free of imports for the same reason as `modules/credits/types.ts`: `db/schema` reads
 * its column types from here, and anything pulled back in would close a cycle.
 */

export const PUSH_PLATFORMS = ["ios", "android"] as const;

export type PushPlatform = (typeof PUSH_PLATFORMS)[number];
