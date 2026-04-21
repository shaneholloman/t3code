/**
 * ProviderAdapterRegistry - Lookup boundary for provider adapter implementations.
 *
 * Maps a `ProviderInstanceId` (the new per-instance routing key) or a
 * `ProviderKind` (legacy single-instance-per-driver key) to the concrete
 * adapter service (Codex, Claude, etc). It does not own session lifecycle
 * or routing rules; `ProviderService` uses this registry together with
 * `ProviderSessionDirectory`.
 *
 * During the driver/instance migration this tag exposes both flavours:
 *
 *   - `getByInstance` / `listInstances` — new per-instance routing. Callers
 *     that already know an `instanceId` (threads, sessions, events)
 *     should prefer these.
 *   - `getByProvider` / `listProviders` — legacy kind-keyed shims. Resolve
 *     against the *default* instance for that driver
 *     (`defaultInstanceIdForDriver(kind) === kind`), matching the pre-Slice-D
 *     behaviour. New code should not grow additional callers of the kind-keyed
 *     methods; they exist so the settings UI, WS refresh RPC, and a handful
 *     of legacy persisted rows can still be routed during the rollout.
 *
 * @module ProviderAdapterRegistry
 */
import type { ProviderInstanceId, ProviderKind } from "@t3tools/contracts";
import { Context } from "effect";
import type { Effect, Stream } from "effect";

import type { ProviderAdapterError, ProviderUnsupportedError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

/**
 * ProviderAdapterRegistryShape - Service API for adapter lookup.
 */
export interface ProviderAdapterRegistryShape {
  /**
   * Resolve the adapter for a specific instance id. Returns
   * `ProviderUnsupportedError` if no such instance is currently registered
   * (which covers "never configured" *and* "configured but the driver is
   * unavailable in this build" — both surface the same failure to callers
   * that expect a working adapter).
   */
  readonly getByInstance: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<ProviderAdapterShape<ProviderAdapterError>, ProviderUnsupportedError>;

  /**
   * List all live instance ids. Excludes unavailable/shadow instances —
   * callers of this method want something they can pass to `getByInstance`.
   */
  readonly listInstances: () => Effect.Effect<ReadonlyArray<ProviderInstanceId>>;

  /**
   * Legacy: resolve the adapter for a provider *kind*. Picks the default
   * instance id (`defaultInstanceIdForDriver(kind) === kind` as a slug) and
   * delegates to `getByInstance`.
   *
   * @deprecated Prefer `getByInstance`. Retained for migration-era call
   * sites (legacy persisted rows, WS refresh RPC).
   */
  readonly getByProvider: (
    provider: ProviderKind,
  ) => Effect.Effect<ProviderAdapterShape<ProviderAdapterError>, ProviderUnsupportedError>;

  /**
   * Legacy: list provider kinds whose default instance is currently
   * registered.
   *
   * @deprecated Prefer `listInstances`. Retained for migration-era call
   * sites that iterate providers to build UI/metrics.
   */
  readonly listProviders: () => Effect.Effect<ReadonlyArray<ProviderKind>>;

  /**
   * Change notification stream mirroring `ProviderInstanceRegistry.streamChanges`.
   * Emits one `void` tick whenever the set of live instances changes
   * (instance added, removed, or rebuilt after a settings edit). Consumers
   * that fan out `adapter.streamEvents` per instance — e.g. `ProviderService`'s
   * runtime event bus — re-pull `listInstances` on each tick and fork new
   * subscriptions for instances they haven't seen yet.
   */
  readonly streamChanges: Stream.Stream<void>;
}

/**
 * ProviderAdapterRegistry - Service tag for provider adapter lookup.
 */
export class ProviderAdapterRegistry extends Context.Service<
  ProviderAdapterRegistry,
  ProviderAdapterRegistryShape
>()("t3/provider/Services/ProviderAdapterRegistry") {}
