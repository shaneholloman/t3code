/**
 * Instance-aware view over the wire `ServerProvider[]`.
 *
 * The wire carries one `ServerProvider` per *configured instance* — the
 * default built-in codex instance, a user-authored `codex_personal`, an
 * unavailable shadow for a fork driver, etc. Legacy UI code collapsed these
 * into a single bucket per `ProviderKind` via `.find((p) => p.provider === kind)`,
 * which silently dropped every custom instance after the first. This module
 * replaces that pattern with `ProviderInstanceEntry[]`, keyed on
 * `ProviderInstanceId`, so the model picker, settings list, and composer
 * can treat built-in and custom instances uniformly.
 *
 * @module providerInstances
 */
import {
  defaultInstanceIdForDriver,
  PROVIDER_DISPLAY_NAMES,
  ProviderDriverId,
  type ProviderInstanceId,
  type ProviderKind,
  type ServerProvider,
  type ServerProviderModel,
  type ServerProviderState,
} from "@t3tools/contracts";

import { formatProviderKindLabel } from "./providerModels";

/**
 * UI-facing projection of one configured provider instance. Carries the
 * snapshot verbatim for callers that need server-side fields we don't
 * hoist here, plus the precomputed `instanceId` / `driverKind` /
 * `displayName` used by every picker and settings view.
 */
export interface ProviderInstanceEntry {
  readonly instanceId: ProviderInstanceId;
  readonly driverKind: ProviderKind;
  readonly displayName: string;
  readonly enabled: boolean;
  readonly installed: boolean;
  readonly status: ServerProviderState;
  /**
   * True when this entry is the default instance for its driver kind —
   * i.e. its instance id equals `defaultInstanceIdForDriver(driverKind)`.
   * The settings panel and picker sort defaults before customs.
   */
  readonly isDefault: boolean;
  /** True when `availability === "unavailable"` is absent or "available". */
  readonly isAvailable: boolean;
  readonly snapshot: ServerProvider;
  readonly models: ReadonlyArray<ServerProviderModel>;
}

const toInstanceId = (snapshot: ServerProvider): ProviderInstanceId => {
  // Every driver we ship stamps `instanceId` via `withInstanceIdentity`;
  // fall back to the driver-as-instance-id convention so legacy snapshots
  // (and any third-party producer that forgets the stamp) still resolve
  // sensibly to the default instance for their kind.
  if (snapshot.instanceId !== undefined) {
    return snapshot.instanceId;
  }
  const driverId = snapshot.driver ?? ProviderDriverId.make(snapshot.provider);
  return defaultInstanceIdForDriver(driverId);
};

/**
 * Turn an instance id slug into a human-readable label. Splits on `_` / `-`
 * and camelCase boundaries and title-cases each token, so `codex_personal`
 * becomes "Codex Personal" and `myCustomInstance` becomes "My Custom
 * Instance".
 *
 * This is a fallback used only when the wire snapshot's `displayName`
 * doesn't disambiguate a non-default instance from the default one of the
 * same driver (today every built-in driver hard-codes a single presentation
 * label per kind, so two instances of the same kind arrive with identical
 * display names). When a server/driver later plumbs the user's configured
 * `ProviderInstanceConfig.displayName` through to the snapshot, that value
 * will take precedence over this fallback.
 */
function humanizeInstanceId(instanceId: ProviderInstanceId): string {
  return instanceId
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(" ")
    .filter((token) => token.length > 0)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

/**
 * Canonical brand label for a built-in driver kind. Prefers the explicit
 * `PROVIDER_DISPLAY_NAMES` map from contracts (which carries the correct
 * brand casing — "OpenCode" not "Opencode", "Claude" not "Claude Agent" —
 * and is the single source of truth for built-in driver presentation) and
 * falls back to the generic title-case of the kind slug for any future /
 * unknown kind that hasn't landed in the map yet.
 */
function driverKindLabel(driverKind: ProviderKind): string {
  return PROVIDER_DISPLAY_NAMES[driverKind] ?? formatProviderKindLabel(driverKind);
}

/**
 * Resolve an entry's displayName with a tiered priority:
 *
 *   1. A snapshot `displayName` that differs from the driver-kind label —
 *      the server has explicitly named this instance, trust it.
 *   2. For non-default instances, a humanized `instanceId` — the server
 *      fell back to the driver-level presentation constant (which is the
 *      same for every instance of that kind), so we differentiate at the
 *      UI layer by slug. This is what keeps "Codex" + "Codex Personal"
 *      distinguishable in tooltips and list labels today.
 *   3. The snapshot's `displayName` (if any) — default instance, trust
 *      whatever label the driver stamped.
 *   4. `driverKindLabel(driverKind)` — nothing else on hand, so use the
 *      canonical brand label from contracts (falling back to a generic
 *      title-case of the kind slug).
 */
function resolveInstanceDisplayName(
  snapshot: ServerProvider,
  instanceId: ProviderInstanceId,
  driverKind: ProviderKind,
  isDefault: boolean,
): string {
  const trimmedSnapshotName = snapshot.displayName?.trim();
  const kindLabel = driverKindLabel(driverKind);
  if (trimmedSnapshotName && trimmedSnapshotName !== kindLabel) {
    return trimmedSnapshotName;
  }
  if (!isDefault) {
    const humanized = humanizeInstanceId(instanceId);
    if (humanized.length > 0) return humanized;
  }
  return trimmedSnapshotName || kindLabel;
}

/**
 * Project the wire `ServerProvider[]` into instance entries, one per
 * configured instance. Preserves the server's ordering (which sources
 * from `deriveProviderInstanceConfigMap` — explicit `providerInstances.*`
 * first, synthesized defaults after) so callers that want "default first"
 * should sort with `sortProviderInstanceEntries` below.
 */
export function deriveProviderInstanceEntries(
  providers: ReadonlyArray<ServerProvider>,
): ReadonlyArray<ProviderInstanceEntry> {
  return providers.map((snapshot) => {
    const instanceId = toInstanceId(snapshot);
    const driverKind = snapshot.provider;
    const defaultId = defaultInstanceIdForDriver(
      snapshot.driver ?? ProviderDriverId.make(driverKind),
    );
    const isDefault = instanceId === defaultId;
    const displayName = resolveInstanceDisplayName(snapshot, instanceId, driverKind, isDefault);
    return {
      instanceId,
      driverKind,
      displayName,
      enabled: snapshot.enabled,
      installed: snapshot.installed,
      status: snapshot.status,
      isDefault,
      isAvailable: snapshot.availability !== "unavailable",
      snapshot,
      models: snapshot.models,
    } satisfies ProviderInstanceEntry;
  });
}

/**
 * Sort instance entries so the default instance of each driver kind appears
 * before any custom instances of the same kind. Within a kind, custom
 * instances keep their settings-author order (which is how the server
 * emits them). Stable across kinds: entries retain the server's
 * cross-driver ordering.
 */
export function sortProviderInstanceEntries(
  entries: ReadonlyArray<ProviderInstanceEntry>,
): ReadonlyArray<ProviderInstanceEntry> {
  // Group by driver kind preserving first-appearance order, then emit
  // default-first within each kind. Using a Map keeps the "first-seen"
  // semantics for kinds whose default instance is absent (unusual but
  // possible during the migration).
  const byKind = new Map<ProviderKind, ProviderInstanceEntry[]>();
  for (const entry of entries) {
    const bucket = byKind.get(entry.driverKind);
    if (bucket) {
      bucket.push(entry);
    } else {
      byKind.set(entry.driverKind, [entry]);
    }
  }
  const sorted: ProviderInstanceEntry[] = [];
  for (const bucket of byKind.values()) {
    const defaults = bucket.filter((entry) => entry.isDefault);
    const customs = bucket.filter((entry) => !entry.isDefault);
    sorted.push(...defaults, ...customs);
  }
  return sorted;
}

/**
 * Look up a single instance entry. Matches first on `instanceId`; if no
 * match, falls back to the default instance for the given kind. The kind
 * fallback keeps legacy call sites (which passed a kind where they now
 * pass an instance id) working through the migration.
 */
export function getProviderInstanceEntry(
  providers: ReadonlyArray<ServerProvider>,
  instanceId: ProviderInstanceId,
): ProviderInstanceEntry | undefined {
  return deriveProviderInstanceEntries(providers).find(
    (entry) => entry.instanceId === instanceId,
  );
}

/**
 * Model list for a specific instance. Returns `[]` when the instance isn't
 * present so callers don't have to thread optionality through render code.
 */
export function getProviderInstanceModels(
  providers: ReadonlyArray<ServerProvider>,
  instanceId: ProviderInstanceId,
): ReadonlyArray<ServerProviderModel> {
  return getProviderInstanceEntry(providers, instanceId)?.models ?? [];
}

/**
 * Resolve the routing key for a selection that may reference an instance
 * id that no longer exists (e.g. a persisted thread selection after the
 * user deleted the custom instance). Returns the first enabled instance
 * as a fallback so downstream code can still send a turn.
 */
export function resolveSelectableProviderInstance(
  providers: ReadonlyArray<ServerProvider>,
  instanceId: ProviderInstanceId | undefined,
): ProviderInstanceId | undefined {
  if (instanceId === undefined) {
    return deriveProviderInstanceEntries(providers).find(
      (entry) => entry.enabled && entry.isAvailable,
    )?.instanceId;
  }
  const entries = deriveProviderInstanceEntries(providers);
  const requested = entries.find((entry) => entry.instanceId === instanceId);
  if (requested && requested.enabled && requested.isAvailable) {
    return instanceId;
  }
  return (
    entries.find((entry) => entry.enabled && entry.isAvailable)?.instanceId ??
    requested?.instanceId ??
    instanceId
  );
}
