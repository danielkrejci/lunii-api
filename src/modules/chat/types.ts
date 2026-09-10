/**
 * The vocabulary the chat is built from.
 *
 * Deliberately free of imports: `db/schema` reads its column types from here, so
 * anything this module pulled back in would close a cycle — the same arrangement
 * `modules/insights/reader.ts` describes for `Reader`.
 *
 * Every union is exported as a value as well as a type, so a route schema validates
 * against the same list the column is narrowed to rather than a second copy of it.
 */

/**
 * Who said it. `assistant` rather than Gemini's own `model`, because that is the word
 * the client and the database use; the translation happens once, where the request is
 * built.
 */
export const CHAT_ROLES = ["user", "assistant"] as const;

export type ChatRole = (typeof CHAT_ROLES)[number];

/**
 * Where a message is in its life.
 *
 * A reader's message is `ready` the moment it exists. An assistant's is `streaming`
 * while the model writes, then `ready` or `failed` — and `failed` still carries
 * whatever text arrived, because a half-written answer is worth more on screen than
 * an empty bubble.
 *
 * Narrower than `GenerationStatus` in modules/insights on purpose: there is no
 * `absent` here. A row is only ever created by a send, so the state where a thing is
 * expected but has never been asked for does not exist.
 */
export const CHAT_MESSAGE_STATUSES = ["streaming", "ready", "failed"] as const;

export type ChatMessageStatus = (typeof CHAT_MESSAGE_STATUSES)[number];

/**
 * What went wrong, as a code the client turns into a sentence.
 *
 * Stored on the message rather than only sent down the stream: a reader who comes
 * back to a failed thread tomorrow deserves the same explanation as the one who
 * watched it fail.
 */
export const CHAT_ERROR_CODES = [
    /** The model failed, timed out, or answered with nothing usable. */
    "generation_failed",
    /** The process died mid-write and the sweeper closed the row. */
    "generation_timeout",
] as const;

export type ChatErrorCode = (typeof CHAT_ERROR_CODES)[number];

/**
 * How long a `streaming` row may go untouched before it is presumed dead.
 *
 * The same five minutes the insight tables use, and for the same reason: it is the
 * timeout in `createStuckGenerationsJob`, and a claim older than this may be taken
 * back by a retry. Generous next to a stream that finishes in twenty seconds, because
 * the cost of reclaiming a live run is a paid answer thrown away.
 */
export const STREAM_TIMEOUT_MINUTES = 5;

/**
 * The longest question the endpoint accepts.
 *
 * Not a safety limit — the window in `history.ts` is what bounds cost. This exists so
 * a pasted document arrives as a validation error rather than as a turn that quietly
 * displaces the day's context.
 */
export const MAX_MESSAGE_LENGTH = 2000;

/**
 * How much of the first message becomes the thread's title.
 *
 * Cut on a word boundary, so a title is never a word sliced in half. Long enough that
 * two threads opened on the same subject are still told apart in the list.
 */
export const MAX_TITLE_LENGTH = 60;
