import { eq } from "drizzle-orm";

import { db } from "../../db";
import { compatibilityPeople, profile } from "../../db/schema";
import { deleteImage, getKeyFromUrl, MAX_IMAGE_SIZE, SUPPORTED_IMAGE_TYPES, uploadImage } from "../../lib/r2";

/**
 * Where a reader's own photos live in R2. One folder per reader, a fresh name per
 * upload, so a new photo never hits a cached old one.
 */
export function profileImageKey(userId: string, mimeType: string) {
    return `profiles/${userId}/${crypto.randomUUID()}.${mimeType.split("/")[1]}`;
}

/**
 * Only Google hands out a photo (Apple sends none), and its URL is the only one taken.
 * `user.image` is written by better-auth from the provider, but this fetches from the
 * server, so anything else is refused rather than trusted.
 */
function isAllowedProviderImage(url: URL) {
    return url.protocol === "https:" && url.hostname.endsWith(".googleusercontent.com");
}

/**
 * Copy the provider's photo into R2, so the reader starts with a photo of their own.
 *
 * Google's URL asks for a 96px square (`=s96-c`); the same URL serves any size, and the
 * avatar wants more than that. Every failure — a foreign host, a slow or broken
 * download, an odd type — leaves the reader without a photo: never worth failing the
 * onboarding over.
 *
 * @returns the public R2 URL, or null when nothing was stored
 */
export async function importProviderImage(userId: string, sourceUrl: string): Promise<string | null> {
    try {
        const url = new URL(sourceUrl.replace(/=s\d+-c$/u, "=s512-c"));

        if (!isAllowedProviderImage(url)) {
            return null;
        }

        const response = await fetch(url, { signal: AbortSignal.timeout(5000) });

        if (!response.ok) {
            console.warn(`importProviderImage: ${response.status} from ${url.hostname}`);
            return null;
        }

        const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";

        if (!SUPPORTED_IMAGE_TYPES.includes(mimeType as (typeof SUPPORTED_IMAGE_TYPES)[number])) {
            console.warn(`importProviderImage: unsupported type "${mimeType}"`);
            return null;
        }

        const buffer = Buffer.from(await response.arrayBuffer());

        if (buffer.length === 0 || buffer.length > MAX_IMAGE_SIZE) {
            return null;
        }

        return await uploadImage(buffer, profileImageKey(userId, mimeType), mimeType);
    } catch (error) {
        console.error("importProviderImage: failed", error);
        return null;
    }
}

/**
 * Delete one stored photo. A URL outside R2 (none today) is left alone.
 */
export async function deleteStoredImage(url: string | null | undefined) {
    if (!url) {
        return;
    }

    const key = getKeyFromUrl(url);

    if (key) {
        await deleteImage(key);
    }
}

/**
 * Every photo a reader stored: their own and those of the people they added.
 *
 * The rows go with the account through the cascades, the files in R2 do not — this is
 * the part the database cannot do. A file that will not delete is logged and skipped:
 * an orphaned photo is no reason to keep an account its owner asked to remove.
 */
export async function deleteUserImages(userId: string) {
    const [profileImages, peopleImages] = await Promise.all([
        db.select({ image: profile.image }).from(profile).where(eq(profile.userId, userId)),
        db
            .select({ image: compatibilityPeople.image })
            .from(compatibilityPeople)
            .where(eq(compatibilityPeople.userId, userId)),
    ]);

    const results = await Promise.allSettled(
        [...profileImages, ...peopleImages].map(({ image }) => deleteStoredImage(image))
    );

    for (const result of results) {
        if (result.status === "rejected") {
            console.error("deleteUserImages: failed to delete an image", result.reason);
        }
    }
}
