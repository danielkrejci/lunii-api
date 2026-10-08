import type { RateLimitPluginOptions } from "@fastify/rate-limit";

/**
 * The 429 body every rate-limited route answers with.
 *
 * Thrown by @fastify/rate-limit and sent by the global error handler in index.ts, so no
 * route schema ever sees it — whatever is built here is what the app receives. `hours`
 * and `minutes` let the app say how long to wait; `silent` keeps the generic Alert out
 * of the way so the screen can say it better.
 */
export const errorResponseBuilder: NonNullable<RateLimitPluginOptions["errorResponseBuilder"]> = (
    _request,
    context
) => {
    const totalSeconds = Math.floor((context?.ttl ?? 0) / 1000);

    return {
        statusCode: 429,
        error: {
            code: "rate_limited",
            hours: Math.floor(totalSeconds / 3600),
            minutes: Math.floor((totalSeconds % 3600) / 60),
            message: "You've reached the limit for now. Please try again later.",
            silent: true,
        },
    };
};
