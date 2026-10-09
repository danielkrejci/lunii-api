import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { appEnv } from "../env";

const r2Client = new S3Client({
    region: "auto",
    endpoint: appEnv.R2_ENDPOINT,
    credentials: {
        accessKeyId: appEnv.R2_ACCESS_KEY_ID,
        secretAccessKey: appEnv.R2_SECRET_ACCESS_KEY,
    },
});

/**
 * Upload an image to Cloudflare R2
 * @param buffer - The image buffer to upload
 * @param key - The storage key (path) for the image
 * @param contentType - MIME type of the image
 * @returns The public URL of the uploaded image
 */
export async function uploadImage(buffer: Buffer, key: string, contentType: string): Promise<string> {
    await r2Client.send(
        new PutObjectCommand({
            Bucket: appEnv.R2_BUCKET_NAME,
            Key: key,
            Body: buffer,
            ContentType: contentType,
        })
    );

    return `${appEnv.R2_PUBLIC_URL}/${key}`;
}

/**
 * Delete an image from Cloudflare R2
 * @param key - The storage key (path) of the image to delete
 */
export async function deleteImage(key: string): Promise<void> {
    await r2Client.send(
        new DeleteObjectCommand({
            Bucket: appEnv.R2_BUCKET_NAME,
            Key: key,
        })
    );
}

/**
 * Derive the R2 storage key from a public image URL
 * @param url - The public URL of the image
 * @returns The storage key, or null if the URL is not a valid R2 public URL
 */
export function getKeyFromUrl(url: string): string | null {
    const prefix = `${appEnv.R2_PUBLIC_URL}/`;

    if (!url.startsWith(prefix)) {
        return null;
    }

    return url.slice(prefix.length);
}

/**
 * Supported image MIME types
 */
export const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/**
 * Maximum image size in bytes (5MB)
 */
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
