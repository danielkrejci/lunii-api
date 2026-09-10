import { FastifyReply } from "fastify";

/**
 * Server-sent events, as much of them as this feature needs.
 *
 * The encoding is separated from the socket so the part that is easy to get subtly
 * wrong — a frame missing its blank line, a payload with a newline in it — can be
 * tested without one.
 */

/** Named events the client switches on. Anything else is a protocol change. */
export type SseEvent = "meta" | "delta" | "done" | "error";

/**
 * One frame.
 *
 * A payload is split across `data:` lines because the wire format has no way to carry a
 * newline inside one. `JSON.stringify` escapes newlines, so today every payload is a
 * single line — this is here so the encoder stays correct if that ever stops being true,
 * and it costs one `split`.
 */
export function encodeEvent(event: SseEvent, data: unknown): string {
    const payload = JSON.stringify(data);
    const lines = payload.split("\n").map((line) => `data: ${line}`);

    return `event: ${event}\n${lines.join("\n")}\n\n`;
}

/**
 * A comment frame. Carries nothing and is ignored by any reader, which is exactly what
 * makes it useful: it keeps an idle connection from being reaped by something in the
 * middle, and tells the client the server is still there while the model thinks.
 */
export function encodeComment(text: string): string {
    return `: ${text}\n\n`;
}

const HEARTBEAT_MS = 15_000;

export interface SseChannel {
    /** Sends a frame. Never throws — a dead socket is an ordinary end, not an error. */
    send(event: SseEvent, data: unknown): void;
    /** Waits for the socket to drain when it has told us to stop writing. */
    flush(): Promise<void>;
    /** False once the client has gone. The caller keeps working; only writing stops. */
    readonly alive: boolean;
    close(): void;
}

/**
 * Takes the response away from Fastify and writes events to the socket directly.
 *
 * `reply.hijack()` is the same mechanism `routes/auth.ts` uses to hand the socket to
 * better-auth. From here Fastify will not send anything itself, which is what allows a
 * response with no fixed length and no serializer.
 *
 * Nothing here throws. A client that has gone — closed the app, lost signal — must not
 * be able to end a generation that has already been paid for, so every failure to write
 * only sets `alive` to false.
 */
export function openSseChannel(reply: FastifyReply): SseChannel {
    reply.hijack();

    reply.raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        // `no-transform` is the half that matters: Cloudflare passes an event stream
        // through unbuffered, but only while it is not also compressing it.
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        // For nginx, if one is ever put in front. Harmless everywhere else.
        "x-accel-buffering": "no",
    });

    reply.raw.flushHeaders();

    let alive = true;
    let needsDrain = false;

    const stop = () => {
        alive = false;
    };

    reply.raw.on("close", stop);
    reply.raw.on("error", stop);

    const write = (frame: string) => {
        if (!alive) {
            return;
        }

        try {
            // `write` returns false when the kernel buffer is full; the caller is
            // expected to wait for `drain` before sending more.
            needsDrain = !reply.raw.write(frame);
        } catch {
            // EPIPE and ERR_STREAM_DESTROYED both land here when the client has gone.
            alive = false;
        }
    };

    const heartbeat = setInterval(() => write(encodeComment("keep-alive")), HEARTBEAT_MS);

    // The process should not be held open by a heartbeat on a stream nobody is reading.
    heartbeat.unref?.();

    return {
        get alive() {
            return alive;
        },

        send(event, data) {
            write(encodeEvent(event, data));
        },

        async flush() {
            if (!alive || !needsDrain) {
                return;
            }

            await new Promise<void>((resolve) => {
                const done = () => {
                    needsDrain = false;
                    resolve();
                };

                reply.raw.once("drain", done);
                reply.raw.once("close", done);
                reply.raw.once("error", done);
            });
        },

        close() {
            clearInterval(heartbeat);

            if (!alive) {
                return;
            }

            alive = false;

            try {
                reply.raw.end();
            } catch {
                // Already gone. Nothing to do and nothing worth reporting.
            }
        },
    };
}
