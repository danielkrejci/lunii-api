import { importPKCS8, SignJWT } from "jose";

import { appEnv } from "../env/appEnv";

export async function generateAppleClientSecret() {
    const key = await importPKCS8(appEnv.APPLE_PRIVATE_KEY, "ES256");

    const now = Math.floor(Date.now() / 1000);

    return await new SignJWT({})
        .setProtectedHeader({
            alg: "ES256",
            kid: appEnv.APPLE_KEY_ID,
        })
        .setIssuer(appEnv.APPLE_TEAM_ID)
        .setSubject(appEnv.APPLE_CLIENT_ID)
        .setAudience("https://appleid.apple.com")
        .setIssuedAt(now)
        .setExpirationTime(now + 180 * 24 * 60 * 60)
        .sign(key);
}

/**
 * Tell Apple the reader is gone, so the app drops out of their Apple ID's "Sign in with
 * Apple" list. Apple asks for this whenever an account is deleted.
 *
 * Revoking either token ends the whole grant; the refresh token is the long-lived one,
 * so it is the one to send when there is a choice.
 */
export async function revokeAppleToken(token: string, tokenTypeHint: "refresh_token" | "access_token") {
    const response = await fetch("https://appleid.apple.com/auth/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: appEnv.APPLE_CLIENT_ID,
            client_secret: await generateAppleClientSecret(),
            token,
            token_type_hint: tokenTypeHint,
        }),
        signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
        throw new Error(`Apple token revoke failed: ${response.status} ${await response.text()}`);
    }
}
