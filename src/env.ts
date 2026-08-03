import { createEnv } from "@t3-oss/env-nextjs";
import { config } from "dotenv";
import { z } from "zod";

config({ path: ".env.local", override: true });

export const env = createEnv({
    server: {
        // Postgres
        POSTGRES_URL: z.url(),

        // Better Auth
        BETTER_AUTH_SECRET: z.string().min(1),
        BETTER_AUTH_URL: z.url(),

        // Apple Auth
        APPLE_TEAM_ID: z.string().min(1),
        APPLE_KEY_ID: z.string().min(1),
        APPLE_CLIENT_ID: z.string().min(1),
        APPLE_PRIVATE_KEY: z.string().min(1),
        APPLE_APP_BUNDLE_IDENTIFIER: z.string().min(1),

        // Google Auth
        GOOGLE_CLIENT_ID: z.string().min(1),
        GOOGLE_CLIENT_SECRET: z.string().min(1),

        // Placekit
        PLACEKIT_API_KEY: z.string().min(1),

        // Google AI
        GEMINI_API_KEY: z.string().min(1),

        // Cloudflare R2
        R2_ACCESS_KEY_ID: z.string().min(1),
        R2_SECRET_ACCESS_KEY: z.string().min(1),
        R2_ENDPOINT: z.string().url(),
        R2_BUCKET_NAME: z.string().min(1),
        R2_PUBLIC_URL: z.string().url(),
    },
    client: {},
    experimental__runtimeEnv: {},
});
