import {
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  type ServerProvider,
} from "@t3tools/contracts";
import { it, assert, vi } from "@effect/vitest";
import { assertFailure } from "@effect/vitest/utils";

import { Effect, Layer, PubSub, Stream } from "effect";

import type { ClaudeAdapterShape } from "../Services/ClaudeAdapter.ts";
import type { CodexAdapterShape } from "../Services/CodexAdapter.ts";
import type { CursorAdapterShape } from "../Services/CursorAdapter.ts";
import type { OpenCodeAdapterShape } from "../Services/OpenCodeAdapter.ts";
import { ProviderAdapterRegistry } from "../Services/ProviderAdapterRegistry.ts";
import { ProviderInstanceRegistry } from "../Services/ProviderInstanceRegistry.ts";
import type { ProviderInstance } from "../ProviderDriver.ts";
import type { TextGenerationShape } from "../../git/Services/TextGeneration.ts";
import { ProviderAdapterRegistryLive } from "./ProviderAdapterRegistry.ts";
import { ProviderUnsupportedError } from "../Errors.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";

const CODEX_DRIVER = ProviderDriverKind.make("codex");
const CLAUDE_AGENT_DRIVER = ProviderDriverKind.make("claudeAgent");
const OPENCODE_DRIVER = ProviderDriverKind.make("opencode");
const CURSOR_DRIVER = ProviderDriverKind.make("cursor");

const fakeCodexAdapter: CodexAdapterShape = {
  provider: CODEX_DRIVER,
  capabilities: { sessionModelSwitch: "in-session" },
  startSession: vi.fn(),
  sendTurn: vi.fn(),
  interruptTurn: vi.fn(),
  respondToRequest: vi.fn(),
  respondToUserInput: vi.fn(),
  stopSession: vi.fn(),
  listSessions: vi.fn(),
  hasSession: vi.fn(),
  readThread: vi.fn(),
  rollbackThread: vi.fn(),
  stopAll: vi.fn(),
  streamEvents: Stream.empty,
};

const fakeClaudeAdapter: ClaudeAdapterShape = {
  provider: CLAUDE_AGENT_DRIVER,
  capabilities: { sessionModelSwitch: "in-session" },
  startSession: vi.fn(),
  sendTurn: vi.fn(),
  interruptTurn: vi.fn(),
  respondToRequest: vi.fn(),
  respondToUserInput: vi.fn(),
  stopSession: vi.fn(),
  listSessions: vi.fn(),
  hasSession: vi.fn(),
  readThread: vi.fn(),
  rollbackThread: vi.fn(),
  stopAll: vi.fn(),
  streamEvents: Stream.empty,
};

const fakeOpenCodeAdapter: OpenCodeAdapterShape = {
  provider: OPENCODE_DRIVER,
  capabilities: { sessionModelSwitch: "in-session" },
  startSession: vi.fn(),
  sendTurn: vi.fn(),
  interruptTurn: vi.fn(),
  respondToRequest: vi.fn(),
  respondToUserInput: vi.fn(),
  stopSession: vi.fn(),
  listSessions: vi.fn(),
  hasSession: vi.fn(),
  readThread: vi.fn(),
  rollbackThread: vi.fn(),
  stopAll: vi.fn(),
  streamEvents: Stream.empty,
};

const fakeCursorAdapter: CursorAdapterShape = {
  provider: CURSOR_DRIVER,
  capabilities: { sessionModelSwitch: "in-session" },
  startSession: vi.fn(),
  sendTurn: vi.fn(),
  interruptTurn: vi.fn(),
  respondToRequest: vi.fn(),
  respondToUserInput: vi.fn(),
  stopSession: vi.fn(),
  listSessions: vi.fn(),
  hasSession: vi.fn(),
  readThread: vi.fn(),
  rollbackThread: vi.fn(),
  stopAll: vi.fn(),
  streamEvents: Stream.empty,
};

// ProviderAdapterRegistryLive is now a facade over ProviderInstanceRegistry —
// it walks `listInstances` once at boot and surfaces the default-instance
// adapter keyed by its driver kind. To test the facade we supply four fake
// instances whose `instanceId === defaultInstanceIdForDriver(driverKind)` so
// they pass the default-instance filter.
const makeFakeInstance = (
  driverKindString: "codex" | "claudeAgent" | "cursor" | "opencode",
  adapter: ProviderInstance["adapter"],
): ProviderInstance => {
  const driverKind = ProviderDriverKind.make(driverKindString);
  return {
    instanceId: defaultInstanceIdForDriver(driverKind),
    driverKind,
    continuationIdentity: {
      driverKind,
      continuationKey: `${driverKind}:instance:${defaultInstanceIdForDriver(driverKind)}`,
    },
    displayName: undefined,
    enabled: true,
    snapshot: {
      getSnapshot: Effect.succeed({} as unknown as ServerProvider),
      refresh: Effect.succeed({} as unknown as ServerProvider),
      streamChanges: Stream.empty,
    },
    adapter,
    textGeneration: {} as unknown as TextGenerationShape,
  };
};

const fakeInstances: ReadonlyArray<ProviderInstance> = [
  makeFakeInstance("codex", fakeCodexAdapter),
  makeFakeInstance("claudeAgent", fakeClaudeAdapter),
  makeFakeInstance("opencode", fakeOpenCodeAdapter),
  makeFakeInstance("cursor", fakeCursorAdapter),
];

const fakeInstanceRegistryLayer = Layer.succeed(ProviderInstanceRegistry, {
  getInstance: (instanceId) =>
    Effect.succeed(fakeInstances.find((instance) => instance.instanceId === instanceId)),
  listInstances: Effect.succeed(fakeInstances),
  listUnavailable: Effect.succeed([]),
  streamChanges: Stream.empty,
  // Tests never drive changes through this fake; acquire a throwaway
  // subscription on an unused PubSub so the shape is satisfied.
  subscribeChanges: Effect.flatMap(PubSub.unbounded<void>(), (pubsub) => PubSub.subscribe(pubsub)),
});

const layer = it.layer(
  Layer.mergeAll(
    Layer.provide(ProviderAdapterRegistryLive, fakeInstanceRegistryLayer),
    NodeServices.layer,
  ),
);

layer("ProviderAdapterRegistryLive", (it) => {
  it.effect("resolves a registered provider adapter", () =>
    Effect.gen(function* () {
      const registry = yield* ProviderAdapterRegistry;
      const codex = yield* registry.getByProvider(CODEX_DRIVER);
      const claude = yield* registry.getByProvider(CLAUDE_AGENT_DRIVER);
      const openCode = yield* registry.getByProvider(OPENCODE_DRIVER);
      const cursor = yield* registry.getByProvider(CURSOR_DRIVER);
      assert.equal(codex, fakeCodexAdapter);
      assert.equal(claude, fakeClaudeAdapter);
      assert.equal(openCode, fakeOpenCodeAdapter);
      assert.equal(cursor, fakeCursorAdapter);

      const providers = yield* registry.listProviders();
      assert.deepEqual(providers, [
        CODEX_DRIVER,
        CLAUDE_AGENT_DRIVER,
        OPENCODE_DRIVER,
        CURSOR_DRIVER,
      ]);
    }),
  );

  it.effect("fails with ProviderUnsupportedError for unknown providers", () =>
    Effect.gen(function* () {
      const registry = yield* ProviderAdapterRegistry;
      const adapter = yield* registry
        .getByProvider(ProviderDriverKind.make("unknown"))
        .pipe(Effect.result);
      assertFailure(adapter, new ProviderUnsupportedError({ provider: "unknown" }));
    }),
  );
});
