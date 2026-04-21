/**
 * ProviderInstanceRegistry — the single Effect service in the new model.
 *
 * Owns a `Map<ProviderInstanceId, ProviderInstance>` produced by running
 * registered driver factories against `ServerSettings.providerInstances`.
 * The registry watches settings; when an instance's config changes (or
 * the entry disappears), the registry tears down the affected instance's
 * scope and rebuilds — that's the entire hot-reload story.
 *
 * What rest-of-server reads from here:
 *   - `getInstance(instanceId)` — for routing turn/session calls.
 *   - `listInstances` — for snapshot aggregation in `ProviderRegistry`.
 *   - `listUnavailable` — `ServerProvider` shadows for instances whose
 *     driver is not registered in this build (rollback / fork tolerance).
 *   - `streamChanges` — coalesced "registry mutated" pings so consumers
 *     can re-pull lists or re-broadcast.
 *
 * @module provider/Services/ProviderInstanceRegistry
 */
import type { ProviderInstanceId, ServerProvider } from "@t3tools/contracts";
import { Context } from "effect";
import type { Effect, Stream } from "effect";

import type { ProviderInstance } from "../ProviderDriver.ts";

export interface ProviderInstanceRegistryShape {
  /**
   * Look up one instance by id. Returns `undefined` (not Option) when the
   * id is unknown — callers branch on falsy and emit
   * `ProviderInstanceNotFoundError`.
   */
  readonly getInstance: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<ProviderInstance | undefined>;
  /**
   * Every available (driver-registered, successfully created) instance,
   * in stable settings-author order.
   */
  readonly listInstances: Effect.Effect<ReadonlyArray<ProviderInstance>>;
  /**
   * Wire-shape shadow snapshots for instances whose driver is unknown to
   * this build (or whose config failed to decode). Suitable for merging
   * directly into `ProviderRegistry` output.
   */
  readonly listUnavailable: Effect.Effect<ReadonlyArray<ServerProvider>>;
  /**
   * Push notification stream emitted whenever the registry's contents
   * change — instance added, removed, or rebuilt. The payload is `void`
   * because consumers always want to re-pull `listInstances` /
   * `listUnavailable` together.
   */
  readonly streamChanges: Stream.Stream<void>;
}

export class ProviderInstanceRegistry extends Context.Service<
  ProviderInstanceRegistry,
  ProviderInstanceRegistryShape
>()("t3/provider/Services/ProviderInstanceRegistry") {}
