/**
 * Test helpers for constructing a `ProviderAdapterRegistryShape` mock from a
 * kind-keyed adapter map.
 *
 * Tests historically assembled a `registry` object with only `getByProvider`
 * + `listProviders` populated. Slice D grew the shape with `getByInstance`
 * and `listInstances`; this helper fills both in from a single kind-keyed
 * input so individual fixtures can stay concise.
 *
 * Non-default instance ids (e.g. `codex_personal`) are not addressable via
 * the shim returned here — the legacy test fixtures only ever had
 * single-instance-per-driver data anyway.
 *
 * @module provider/testUtils/providerAdapterRegistryMock
 */
import {
  defaultInstanceIdForDriver,
  ProviderDriverId,
  type ProviderInstanceId,
  type ProviderKind,
} from "@t3tools/contracts";
import { Effect, Stream } from "effect";

import { ProviderUnsupportedError, type ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import type { ProviderAdapterRegistryShape } from "../Services/ProviderAdapterRegistry.ts";

export type KindAdapterMap = Partial<
  Record<ProviderKind, ProviderAdapterShape<ProviderAdapterError>>
>;

/**
 * Build a `ProviderAdapterRegistryShape` from a kind-keyed adapter map.
 * Every adapter present in the map is addressable via both the legacy
 * `getByProvider(kind)` path and the new `getByInstance(id)` path (where
 * `id = defaultInstanceIdForDriver(kind)`).
 */
export const makeAdapterRegistryMock = (adapters: KindAdapterMap): ProviderAdapterRegistryShape => {
  const byInstanceId = new Map<ProviderInstanceId, ProviderAdapterShape<ProviderAdapterError>>();
  for (const [kind, adapter] of Object.entries(adapters)) {
    if (!adapter) continue;
    const driverId = ProviderDriverId.make(kind);
    byInstanceId.set(defaultInstanceIdForDriver(driverId), adapter);
  }

  const getByInstance: ProviderAdapterRegistryShape["getByInstance"] = (instanceId) => {
    const adapter = byInstanceId.get(instanceId);
    return adapter
      ? Effect.succeed(adapter)
      : Effect.fail(
          new ProviderUnsupportedError({
            provider: instanceId as unknown as ProviderKind,
          }),
        );
  };

  const getByProvider: ProviderAdapterRegistryShape["getByProvider"] = (provider) => {
    const adapter = adapters[provider];
    return adapter
      ? Effect.succeed(adapter)
      : Effect.fail(new ProviderUnsupportedError({ provider }));
  };

  return {
    getByInstance,
    listInstances: () => Effect.succeed(Array.from(byInstanceId.keys())),
    getByProvider,
    listProviders: () =>
      Effect.succeed(
        Object.entries(adapters)
          .filter(([, adapter]) => adapter !== undefined)
          .map(([kind]) => kind as ProviderKind),
      ),
    // Static test fixtures don't reload; an empty stream is enough to
    // satisfy the shape. Tests exercising hot-reload build their own
    // stream via the real `ProviderInstanceRegistry`.
    streamChanges: Stream.empty,
  };
};
