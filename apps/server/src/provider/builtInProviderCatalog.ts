import type {
  ProviderDriverId,
  ProviderInstanceId,
  ProviderKind,
  ServerProvider,
} from "@t3tools/contracts";
import type { Stream } from "effect";
import type { ProviderAdapterError } from "./Errors.ts";
import type { ProviderAdapterShape } from "./Services/ProviderAdapter.ts";
import type { ServerProviderShape } from "./Services/ServerProvider.ts";

export type ProviderSnapshotSource = {
  /**
   * Routing key — uniquely identifies this instance in the aggregated
   * snapshot list. Two different snapshot sources may share the same
   * `provider` kind (multiple instances of the same driver).
   */
  readonly instanceId: ProviderInstanceId;
  /** Driver implementation id. Equal to `provider` for built-in drivers. */
  readonly driverId: ProviderDriverId;
  /** Kind for legacy kind-keyed lookup paths (cache files, WS shim). */
  readonly provider: ProviderKind;
  readonly getSnapshot: ServerProviderShape["getSnapshot"];
  readonly refresh: ServerProviderShape["refresh"];
  readonly streamChanges: Stream.Stream<ServerProvider>;
};

type BuiltInProviderServiceMap = Record<ProviderKind, ServerProviderShape>;
type BuiltInAdapterMap = {
  readonly codex: ProviderAdapterShape<ProviderAdapterError>;
  readonly claudeAgent: ProviderAdapterShape<ProviderAdapterError>;
  readonly opencode: ProviderAdapterShape<ProviderAdapterError>;
  readonly cursor?: ProviderAdapterShape<ProviderAdapterError>;
};

export const BUILT_IN_PROVIDER_ORDER = [
  "codex",
  "claudeAgent",
  "opencode",
  "cursor",
] as const satisfies ReadonlyArray<ProviderKind>;

export function createBuiltInProviderSources(
  services: BuiltInProviderServiceMap,
): ReadonlyArray<ProviderSnapshotSource> {
  return BUILT_IN_PROVIDER_ORDER.map((provider) => {
    // For legacy built-in-only callers the default instance id equals the
    // kind slug (that's the invariant `defaultInstanceIdForDriver` preserves).
    const slug = provider as unknown as ProviderInstanceId;
    const driverId = provider as unknown as ProviderDriverId;
    return {
      instanceId: slug,
      driverId,
      provider,
      getSnapshot: services[provider].getSnapshot,
      refresh: services[provider].refresh,
      streamChanges: services[provider].streamChanges,
    };
  });
}

export function createBuiltInAdapterList(
  adapters: BuiltInAdapterMap,
): ReadonlyArray<ProviderAdapterShape<ProviderAdapterError>> {
  return [
    adapters.codex,
    adapters.claudeAgent,
    adapters.opencode,
    ...(adapters.cursor ? [adapters.cursor] : []),
  ];
}
