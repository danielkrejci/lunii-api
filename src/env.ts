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

        // RevenueCat
        /** The fixed string RevenueCat sends as the `Authorization` header on webhooks. */
        REVENUECAT_WEBHOOK_SECRET: z.string().min(1),
        /** v2 secret key (`sk_...`), for the pull-based reconciliation in /api/credits/sync. */
        REVENUECAT_API_KEY: z.string().min(1),
        REVENUECAT_PROJECT_ID: z.string().min(1),
        /**
         * Whether a sandbox purchase grants anything. Off in production, or a TestFlight
         * tester with a five-minute subscription becomes a real subscriber in real data.
         */
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
        R2_ENDPOINT: z.string().url(),
        R2_BUCKET_NAME: z.string().min(1),
        R2_PUBLIC_URL: z.string().url(),
    },
    client: {},
    experimental__runtimeEnv: {},
});
