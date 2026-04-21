/**
 * Helpers for synthesizing "unavailable" `ServerProvider` snapshots.
 *
 * When `ServerSettings.providerInstances` (or persisted thread/session
 * state) references a driver this build does not ship — typical after a
 * downgrade from a fork or a feature-branch test session — the runtime
 * needs to surface the entry to the UI without crashing. This module
 * produces shadow snapshots that satisfy `ServerProvider`'s wire shape
 * while signalling unavailability.
 *
 * The trade-off baked in: `ServerProvider.provider` is the legacy closed
 * `ProviderKind` literal union, but the real driver id may be anything
 * (`ollama`, `gemini-fork`, …). Rather than widen `provider` and break
 * every legacy consumer at once, we pin it to a placeholder built-in
 * (`codex`) and put the real driver in `driver`. Consumers that know
 * about instance-aware snapshots branch on `driver`; legacy consumers
 * still see a well-formed payload.
 *
 * @module unavailableProviderSnapshot
 */
import { ProviderDriverId, type ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";

import { buildServerProvider } from "./providerSnapshot.ts";

/**
 * Placeholder `ProviderKind` used when the real driver is unknown to this
 * build. Chosen as the canonical built-in so legacy consumers — which
 * still branch on `provider` — never see a value they can't handle.
 * Consumers branching on driver behavior should read `snapshot.driver`.
 */
const UNAVAILABLE_PROVIDER_PLACEHOLDER = "codex" as const;

export interface UnavailableProviderSnapshotInput {
  readonly driverId: ProviderDriverId | string;
  readonly instanceId: ProviderInstanceId;
  readonly displayName?: string | undefined;
  readonly reason: string;
  /**
   * Optional override for `checkedAt`. Defaulted to `new Date()` so callers
   * (notably tests) don't have to pass it.
   */
  readonly checkedAt?: string;
}

/**
 * Produce a `ServerProvider` snapshot representing a configured instance
 * whose driver the running build does not implement. The result is safe
 * to broadcast over the wire and is structured so the web UI can render
 * a "missing driver" affordance without special-casing.
 */
export function buildUnavailableProviderSnapshot(
  input: UnavailableProviderSnapshotInput,
): ServerProvider {
  const checkedAt = input.checkedAt ?? new Date().toISOString();
  const displayName = input.displayName?.trim() || (input.driverId as string);

  const base = buildServerProvider({
    provider: UNAVAILABLE_PROVIDER_PLACEHOLDER,
    presentation: { displayName },
    enabled: false,
    checkedAt,
    models: [],
    skills: [],
    probe: {
      installed: false,
      version: null,
      status: "error",
      auth: { status: "unknown" },
      message: input.reason,
    },
  });

  return {
    ...base,
    instanceId: input.instanceId,
    driver:
      typeof input.driverId === "string" ? ProviderDriverId.make(input.driverId) : input.driverId,
    availability: "unavailable",
    unavailableReason: input.reason,
  };
}
