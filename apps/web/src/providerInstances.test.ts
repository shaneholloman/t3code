import {
  ProviderDriverId,
  ProviderInstanceId,
  type ProviderKind,
  type ServerProvider,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";
import {
  deriveProviderInstanceEntries,
  resolveProviderKindForInstanceSelection,
} from "./providerInstances";

function provider(input: {
  provider: ProviderKind;
  instanceId: string;
  enabled?: boolean;
  displayName?: string;
}): ServerProvider {
  return {
    provider: input.provider,
    instanceId: ProviderInstanceId.make(input.instanceId),
    driver: ProviderDriverId.make(input.provider),
    ...(input.displayName ? { displayName: input.displayName } : {}),
    enabled: input.enabled ?? true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-01-01T00:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
  };
}

describe("deriveProviderInstanceEntries", () => {
  it("rejects snapshots without instance ids instead of inferring from driver kind", () => {
    const legacySnapshot: ServerProvider = {
      provider: "codex",
      driver: ProviderDriverId.make("codex"),
      enabled: true,
      installed: true,
      version: null,
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-01-01T00:00:00.000Z",
      models: [],
      slashCommands: [],
      skills: [],
    };

    expect(() => deriveProviderInstanceEntries([legacySnapshot])).toThrow("missing instanceId");
  });
});

describe("resolveProviderKindForInstanceSelection", () => {
  it("maps custom provider instance ids back to their driver kind", () => {
    const providers = [
      provider({ provider: "codex", instanceId: "codex" }),
      provider({
        provider: "claudeAgent",
        instanceId: "claude_openrouter",
        displayName: "Claude OpenRouter",
      }),
    ];
    const entries = deriveProviderInstanceEntries(providers);

    expect(
      resolveProviderKindForInstanceSelection(
        entries,
        providers,
        ProviderInstanceId.make("claude_openrouter"),
      ),
    ).toBe("claudeAgent");
  });

  it("does not guess a provider kind when the instance selection is unknown", () => {
    const providers = [
      provider({ provider: "codex", instanceId: "codex", enabled: false }),
      provider({ provider: "claudeAgent", instanceId: "claudeAgent" }),
    ];
    const entries = deriveProviderInstanceEntries(providers);

    expect(
      resolveProviderKindForInstanceSelection(
        entries,
        providers,
        ProviderInstanceId.make("removed_instance"),
      ),
    ).toBeUndefined();
  });
});
