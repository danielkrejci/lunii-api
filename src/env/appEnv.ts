import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

import { dbEnv } from "./dbEnv";

export const appEnv = createEnv({
    // Postgres
    extends: [dbEnv],
    server: {
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

        // RevenueCat
        REVENUECAT_WEBHOOK_SECRET: z.string().min(1),
        REVENUECAT_API_KEY: z.string().min(1),
        REVENUECAT_PROJECT_ID: z.string().min(1),
        REVENUECAT_ALLOW_SANDBOX: z.stringbool().default(false),

        // Credits
        /**
         * The kill switch. While off, nothing is charged and nothing is written — every
         * reader is reported as unlimited, so the API behaves exactly as it did before
         * credits existed. This is what makes the rollout a flag rather than a migration.
         */
        CREDITS_ENFORCED: z.stringbool().default(false),

        // Cloudflare R2
        R2_ACCESS_KEY_ID: z.string().min(1),
        R2_SECRET_ACCESS_KEY: z.string().min(1),
        R2_ENDPOINT: z.url(),
        R2_BUCKET_NAME: z.string().min(1),
        R2_PUBLIC_URL: z.url(),

        // Cron
        ENABLE_CRON_JOBS: z.stringbool().default(false),
    },
    client: {},
    experimental__runtimeEnv: {},
});
