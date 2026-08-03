/**
 * Error carrying an explicit HTTP status code. Throw it inside a route handler
 * when a condition is the client's fault (bad input, forbidden, not found) so
 * the catch block can return the right status instead of a generic 500.
 */
export class HttpError extends Error {
    constructor(
        public readonly statusCode: number,
        message: string
    ) {
        super(message);
        this.name = "HttpError";
    }
}
