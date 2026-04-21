import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Sink from "effect/Sink";
import * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as CodexError from "../errors.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Bytes of stderr retained for the termination error. Keep this modest —
 * stderr is typically a few lines of diagnostic output; 4KB is enough to
 * see a Rust panic or a config parse error tail without ballooning
 * long-running sessions' memory.
 */
const STDERR_TAIL_BYTES = 4096;

/** Upper bound on how long `readStderrTail` will wait for the stderr sink
 * to finish draining after the subprocess has exited. The stream usually
 * closes in a few milliseconds; if it doesn't within this window we return
 * whatever has been captured so far so callers don't hang. */
const STDERR_FLUSH_TIMEOUT_MS = 500;

export interface CodexAppServerChildStdio {
  readonly stdio: Stdio.Stdio;
  /**
   * Read the most recent {@link STDERR_TAIL_BYTES} bytes of subprocess
   * stderr as a decoded string (trimmed). Waits up to
   * {@link STDERR_FLUSH_TIMEOUT_MS} for the stderr stream to finish
   * draining so captures after subprocess exit don't race with
   * still-in-flight stderr chunks.
   */
  readonly readStderrTail: Effect.Effect<string>;
}

/**
 * Build the stdio config for a spawned `codex app-server` subprocess.
 *
 * Unlike the naive "drain stderr" default, this keeps a ring buffer of
 * the last ~4KB of stderr output so {@link makeTerminationError} can
 * surface it in `CodexAppServerProcessExitedError`. Without this the
 * probe sees "Codex App Server process exited with code 1" with no
 * context — we throw away the error message the subprocess printed.
 *
 * The function is an Effect because we need a `Deferred` to signal when
 * the stderr sink has finished draining; reading the buffer before that
 * would race with still-in-flight chunks produced by the subprocess in
 * the milliseconds before exit.
 */
export const makeChildStdio = Effect.fn("makeChildStdio")(function* (
  handle: ChildProcessSpawner.ChildProcessHandle,
) {
  // Closure-backed ring buffer. Only the Sink.forEach callback mutates
  // this; readStderrTail waits for the sink to complete before reading.
  let stderrBuffer = new Uint8Array(0);
  const stderrDrained = yield* Deferred.make<void>();

  const stdio = Stdio.make({
    args: Effect.succeed([]),
    stdin: handle.stdout,
    stdout: () =>
      Sink.mapInput(handle.stdin, (chunk: string | Uint8Array) =>
        typeof chunk === "string" ? encoder.encode(chunk) : chunk,
      ),
    stderr: () =>
      Sink.forEach((chunk: string | Uint8Array) =>
        Effect.sync(() => {
          const bytes = typeof chunk === "string" ? encoder.encode(chunk) : chunk;
          if (bytes.byteLength === 0) return;
          const combined = new Uint8Array(stderrBuffer.byteLength + bytes.byteLength);
          combined.set(stderrBuffer);
          combined.set(bytes, stderrBuffer.byteLength);
          stderrBuffer =
            combined.byteLength > STDERR_TAIL_BYTES
              ? combined.slice(combined.byteLength - STDERR_TAIL_BYTES)
              : combined;
        }),
      ).pipe(Sink.ensuring(Deferred.succeed(stderrDrained, undefined))),
  });

  const readStderrTail: Effect.Effect<string> = Effect.gen(function* () {
    // Wait for the stderr stream to finish, but cap the wait so a hung
    // sink (e.g. subprocess exit races) can't stall termination-error
    // construction.
    yield* Deferred.await(stderrDrained).pipe(
      Effect.timeout(`${STDERR_FLUSH_TIMEOUT_MS} millis`),
      Effect.ignore,
    );
    return decoder.decode(stderrBuffer).trim();
  });

  return { stdio, readStderrTail } satisfies CodexAppServerChildStdio;
});

export const makeInMemoryStdio = Effect.fn("makeInMemoryStdio")(function* () {
  const input = yield* Queue.unbounded<Uint8Array, Cause.Done<void>>();
  const output = yield* Queue.unbounded<string>();
  const inMemoryDecoder = new TextDecoder();

  return {
    stdio: Stdio.make({
      args: Effect.succeed([]),
      stdin: Stream.fromQueue(input),
      stdout: () =>
        Sink.forEach((chunk: string | Uint8Array) =>
          Queue.offer(
            output,
            typeof chunk === "string" ? chunk : inMemoryDecoder.decode(chunk, { stream: true }),
          ),
        ),
      stderr: () => Sink.drain,
    }),
    input,
    output,
  };
});

/**
 * Build the termination-error Effect for a spawned subprocess.
 *
 * When the subprocess exits, the resulting `CodexAppServerProcessExitedError`
 * is enriched with the stderr tail (if a reader was provided) so callers
 * can see *why* the subprocess died — not just that it did.
 */
export const makeTerminationError = (
  handle: ChildProcessSpawner.ChildProcessHandle,
  readStderrTail: Effect.Effect<string> = Effect.succeed(""),
): Effect.Effect<CodexError.CodexAppServerError> =>
  Effect.matchEffect(handle.exitCode, {
    onFailure: (cause) =>
      Effect.succeed(
        new CodexError.CodexAppServerTransportError({
          detail: "Failed to determine Codex App Server process exit status",
          cause,
        }),
      ),
    onSuccess: (code) =>
      readStderrTail.pipe(
        Effect.map(
          (tail) =>
            new CodexError.CodexAppServerProcessExitedError({
              code,
              ...(tail ? { stderrTail: tail } : {}),
            }),
        ),
      ),
  });
