/**
 * ProviderAdapterRegistryLive — facade over `ProviderInstanceRegistry`.
 *
 * `ProviderAdapterRegistry` historically mapped one `ProviderKind` to one
 * adapter via the four `<X>AdapterLive` singleton Layers. The per-instance
 * refactor moved adapter construction inside each `ProviderDriver.create()`:
 * adapters are now bundled on the `ProviderInstance` that the
 * `ProviderInstanceRegistry` owns.
 *
 * This facade fulfills the `ProviderAdapterRegistryShape` contract by doing
 * dynamic look-ups against `ProviderInstanceRegistry` on every call. That
 * means settings-driven hot-reload shows up here automatically — adding a
 * new instance via settings makes `getByInstance` resolve immediately
 * without rebuilding the facade.
 *
 * Legacy `getByProvider(kind)` is a thin shim that routes to the *default*
 * instance for that driver (`defaultInstanceIdForDriver(kind) === kind`),
 * matching the pre-Slice-D single-instance-per-driver behaviour.
 *
 * @module ProviderAdapterRegistryLive
 */
import {
  defaultInstanceIdForDriver,
  ProviderInstanceId,
  type ProviderKind,
} from "@t3tools/contracts";
import { Effect, Layer } from "effect";

import { ProviderUnsupportedError } from "../Errors.ts";
import { ProviderInstanceRegistry } from "../Services/ProviderInstanceRegistry.ts";
import {
  ProviderAdapterRegistry,
  type ProviderAdapterRegistryShape,
} from "../Services/ProviderAdapterRegistry.ts";

const makeProviderAdapterRegistry = Effect.fn("makeProviderAdapterRegistry")(function* () {
  const registry = yield* ProviderInstanceRegistry;

  const getByInstance: ProviderAdapterRegistryShape["getByInstance"] = (instanceId) =>
    registry.getInstance(instanceId).pipe(
      Effect.flatMap((instance) =>
        instance === undefined
          ? Effect.fail(
              new ProviderUnsupportedError({
                provider: instanceId as unknown as ProviderKind,
              }),
            )
          : Effect.succeed(instance.adapter),
      ),
    );

  const listInstances: ProviderAdapterRegistryShape["listInstances"] = () =>
    registry.listInstances.pipe(
      Effect.map((instances) => instances.map((instance) => instance.instanceId)),
    );

  // Legacy kind-keyed shim: translate `kind` into the default instance
  // id for that driver (the kind literal itself, as a slug) and delegate.
  const getByProvider: ProviderAdapterRegistryShape["getByProvider"] = (provider) =>
    getByInstance(
      defaultInstanceIdForDriver(
        provider as unknown as Parameters<typeof defaultInstanceIdForDriver>[0],
      ),
    ).pipe(
      // Re-shape the failure so callers still see `ProviderUnsupportedError`
      // carrying the *kind* they asked about, not the derived instance id.
      Effect.mapError(() => new ProviderUnsupportedError({ provider })),
    );

  const listProviders: ProviderAdapterRegistryShape["listProviders"] = () =>
    registry.listInstances.pipe(
      Effect.map((instances) => {
        const kinds = new Set<ProviderKind>();
        for (const instance of instances) {
          const defaultId = defaultInstanceIdForDriver(instance.driverId);
          if (instance.instanceId === defaultId) {
            // Only the default-instance rows show up through the legacy
            // shim — custom instances like `codex_personal` have no
            // `ProviderKind` equivalent.
            kinds.add(instance.driverId as unknown as ProviderKind);
          }
        }
        return Array.from(kinds);
      }),
    );

  return {
    getByInstance,
    listInstances,
    getByProvider,
    listProviders,
    // Proxy directly — the facade has no state of its own; the instance
    // registry already coalesces adds/removes/rebuilds into one emission.
    streamChanges: registry.streamChanges,
  } satisfies ProviderAdapterRegistryShape;
});

export const ProviderAdapterRegistryLive = Layer.effect(
  ProviderAdapterRegistry,
  makeProviderAdapterRegistry(),
);

// Exposed for tests that want to build a facade over a pre-assembled
// `ProviderInstanceRegistry` without pulling in the whole boot graph.
export { makeProviderAdapterRegistry };

// Re-export for consumers that need the accessor shape. The service tag
// itself lives in `Services/ProviderAdapterRegistry.ts`.
export { ProviderAdapterRegistry } from "../Services/ProviderAdapterRegistry.ts";
// Re-export for consumers (including tests) that construct a
// `ProviderInstanceId` before calling `getByInstance`.
export { ProviderInstanceId };
