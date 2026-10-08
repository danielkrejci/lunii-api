import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * The one 500 a route sends from its own catch.
 *
 * The cause goes to the log and nowhere else: a stack trace in the body helps nobody
 * on a phone, and leaks internals the moment a dev build points at production.
 */
export function sendInternalError(request: FastifyRequest, reply: FastifyReply, error: unknown, logMessage: string) {
    request.log.error({ err: error }, logMessage);

    return reply.status(500).send({ error: { code: "internal_error", message: "Internal Server Error" } });
}

/**
 * Whether a query failed on a unique constraint (Postgres 23505).
 *
 * drizzle wraps the driver's error in a DrizzleQueryError, so the code sits on `cause`;
 * the bare error is checked too, for anything that reaches pg without drizzle.
 */
export function isUniqueViolation(error: unknown): boolean {
    return codeOf(error) === "23505" || (isObject(error) && codeOf(error.cause) === "23505");
}

function isObject(value: unknown): value is { code?: unknown; cause?: unknown } {
    return typeof value === "object" && value !== null;
}

function codeOf(value: unknown): unknown {
    return isObject(value) ? value.code : undefined;
}
