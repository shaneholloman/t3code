/**
 * RoutingTextGeneration – Dispatches text generation requests to either the
 * Codex CLI or Claude CLI implementation based on the provider in each
 * request input.
 *
 * When `modelSelection.instanceId` resolves to a `"claudeAgent"` driver the request is forwarded to
 * the Claude layer; for any other value (including the default `undefined`) it
 * falls through to the Codex layer.
 *
 * @module RoutingTextGeneration
 */
import { Effect, Layer, Context } from "effect";

import { isBuiltInDriverId, TextGenerationError } from "@t3tools/contracts";

import { TextGeneration, type TextGenerationShape } from "../Services/TextGeneration.ts";
import { CodexTextGenerationLive } from "./CodexTextGeneration.ts";
import { ClaudeTextGenerationLive } from "./ClaudeTextGeneration.ts";
import { CursorTextGenerationLive } from "./CursorTextGeneration.ts";
import { OpenCodeTextGenerationLive } from "./OpenCodeTextGeneration.ts";

// ---------------------------------------------------------------------------
// Internal service tags so both concrete layers can coexist.
// ---------------------------------------------------------------------------

class CodexTextGen extends Context.Service<CodexTextGen, TextGenerationShape>()(
  "t3/git/Layers/RoutingTextGeneration/CodexTextGen",
) {}

class ClaudeTextGen extends Context.Service<ClaudeTextGen, TextGenerationShape>()(
  "t3/git/Layers/RoutingTextGeneration/ClaudeTextGen",
) {}

class CursorTextGen extends Context.Service<CursorTextGen, TextGenerationShape>()(
  "t3/git/Layers/RoutingTextGeneration/CursorTextGen",
) {}

class OpenCodeTextGen extends Context.Service<OpenCodeTextGen, TextGenerationShape>()(
  "t3/git/Layers/RoutingTextGeneration/OpenCodeTextGen",
) {}

// ---------------------------------------------------------------------------
// Routing implementation
// ---------------------------------------------------------------------------

const makeRoutingTextGeneration = Effect.gen(function* () {
  const byProvider = {
    codex: yield* CodexTextGen,
    claudeAgent: yield* ClaudeTextGen,
    cursor: yield* CursorTextGen,
    opencode: yield* OpenCodeTextGen,
  } as const;

  // `ModelSelection.provider` is an open driver-id slug — it may name a
  // driver this build doesn't ship (fork / rollback case). Surface that
  // as a structured `TextGenerationError` instead of an `undefined`-key
  // crash; callers can decide whether to retry under a different driver
  // or surface "driver not installed" to the user.
  const route = <Op extends keyof TextGenerationShape>(
    operation: Op,
    provider: string,
  ): Effect.Effect<TextGenerationShape[Op], TextGenerationError, never> => {
    if (!isBuiltInDriverId(provider)) {
      return Effect.fail(
        new TextGenerationError({
          operation,
          detail: `No text-generation driver registered for provider "${provider}".`,
        }),
      );
    }
    return Effect.succeed(byProvider[provider][operation]);
  };

  return {
    generateCommitMessage: (input) =>
      route("generateCommitMessage", input.modelSelection.instanceId).pipe(
        Effect.flatMap((fn) => fn(input)),
      ),
    generatePrContent: (input) =>
      route("generatePrContent", input.modelSelection.instanceId).pipe(
        Effect.flatMap((fn) => fn(input)),
      ),
    generateBranchName: (input) =>
      route("generateBranchName", input.modelSelection.instanceId).pipe(
        Effect.flatMap((fn) => fn(input)),
      ),
    generateThreadTitle: (input) =>
      route("generateThreadTitle", input.modelSelection.instanceId).pipe(
        Effect.flatMap((fn) => fn(input)),
      ),
  } satisfies TextGenerationShape;
});

const InternalCodexLayer = Layer.effect(
  CodexTextGen,
  Effect.gen(function* () {
    const svc = yield* TextGeneration;
    return svc;
  }),
).pipe(Layer.provide(CodexTextGenerationLive));

const InternalClaudeLayer = Layer.effect(
  ClaudeTextGen,
  Effect.gen(function* () {
    const svc = yield* TextGeneration;
    return svc;
  }),
).pipe(Layer.provide(ClaudeTextGenerationLive));

const InternalCursorLayer = Layer.effect(
  CursorTextGen,
  Effect.gen(function* () {
    const svc = yield* TextGeneration;
    return svc;
  }),
).pipe(Layer.provide(CursorTextGenerationLive));

const InternalOpenCodeLayer = Layer.effect(
  OpenCodeTextGen,
  Effect.gen(function* () {
    const svc = yield* TextGeneration;
    return svc;
  }),
).pipe(Layer.provide(OpenCodeTextGenerationLive));

export const RoutingTextGenerationLive = Layer.effect(
  TextGeneration,
  makeRoutingTextGeneration,
).pipe(
  Layer.provide(InternalCodexLayer),
  Layer.provide(InternalClaudeLayer),
  Layer.provide(InternalCursorLayer),
  Layer.provide(InternalOpenCodeLayer),
);
