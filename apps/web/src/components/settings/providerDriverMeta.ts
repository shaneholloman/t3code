import type { ProviderDriverId, ProviderKind } from "@t3tools/contracts";
import { ClaudeAI, CursorIcon, type Icon, OpenAI, OpenCodeIcon } from "../Icons";

/**
 * A single editable field exposed on a provider instance. `key` must match
 * the corresponding driver config schema in
 * `packages/contracts/src/settings.ts` — values are merged into the saved
 * `ProviderInstanceConfig.config` blob (or the legacy
 * `ServerSettings.providers[kind]` struct) under this key verbatim.
 */
export interface DriverFieldDef {
  readonly key: string;
  readonly label: string;
  readonly placeholder?: string;
  readonly description?: string;
  readonly type?: "text" | "password";
}

/**
 * Presentation + editable-field metadata for a built-in driver. Shared
 * between the Add-Instance dialog and the per-instance settings card so
 * both surfaces offer the same keys for the same driver.
 */
export interface DriverOption {
  readonly value: ProviderKind;
  readonly label: string;
  readonly icon: Icon;
  readonly fields: readonly DriverFieldDef[];
  /**
   * Optional short label rendered as a `variant="warning"` badge next to
   * the instance title. Used to flag drivers that still ship under an
   * early-access or preview gate — the flag is a property of the driver
   * kind (not a specific instance), so every instance of that driver —
   * built-in default or custom — advertises the same marker.
   */
  readonly badgeLabel?: string;
}

export const DRIVER_OPTIONS: readonly DriverOption[] = [
  {
    value: "codex",
    label: "Codex",
    icon: OpenAI,
    fields: [
      {
        key: "binaryPath",
        label: "Binary path",
        placeholder: "codex",
        description: "Path to the Codex binary used by this instance.",
      },
      {
        key: "homePath",
        label: "CODEX_HOME path",
        placeholder: "~/.codex",
        description: "Custom Codex home and config directory.",
      },
    ],
  },
  {
    value: "claudeAgent",
    label: "Claude",
    icon: ClaudeAI,
    fields: [
      {
        key: "binaryPath",
        label: "Binary path",
        placeholder: "claude",
        description: "Path to the Claude binary used by this instance.",
      },
      {
        key: "launchArgs",
        label: "Launch arguments",
        placeholder: "e.g. --chrome",
        description: "Additional CLI arguments passed on session start.",
      },
    ],
  },
  {
    value: "cursor",
    label: "Cursor",
    icon: CursorIcon,
    badgeLabel: "Early Access",
    fields: [
      {
        key: "binaryPath",
        label: "Binary path",
        placeholder: "agent",
        description: "Path to the Cursor agent binary.",
      },
      {
        key: "apiEndpoint",
        label: "API endpoint",
        placeholder: "https://…",
        description: "Override the Cursor API endpoint for this instance.",
      },
    ],
  },
  {
    value: "opencode",
    label: "OpenCode",
    icon: OpenCodeIcon,
    fields: [
      {
        key: "binaryPath",
        label: "Binary path",
        placeholder: "opencode",
        description: "Path to the OpenCode binary.",
      },
      {
        key: "serverUrl",
        label: "Server URL",
        placeholder: "http://127.0.0.1:4096",
        description: "Leave blank to let T3 Code spawn the server when needed.",
      },
      {
        key: "serverPassword",
        label: "Server password",
        placeholder: "Optional",
        type: "password",
        description: "Stored in plain text on disk.",
      },
    ],
  },
];

/**
 * Lookup table for built-in drivers. Typed `Record<ProviderKind, DriverOption>`
 * so consumers that already narrowed to the closed `ProviderKind` union — such
 * as the Add-Instance dialog — can index it without an `undefined` guard.
 * Callers operating on the open `ProviderDriverId` slug should go through
 * `getDriverOption` instead, which returns `DriverOption | undefined`.
 */
export const DRIVER_OPTION_BY_VALUE: Record<ProviderKind, DriverOption> = Object.fromEntries(
  DRIVER_OPTIONS.map((option) => [option.value, option]),
) as Record<ProviderKind, DriverOption>;

/**
 * Look up the driver metadata for an instance's `driver` field. Accepts
 * either the branded `ProviderDriverId` slug or the `ProviderKind` literal.
 * Returns `undefined` for fork / unknown drivers so callers can decide how
 * to render them — typically by falling back to a generic card.
 */
export function getDriverOption(
  driver: ProviderDriverId | ProviderKind | string | undefined,
): DriverOption | undefined {
  if (driver === undefined) return undefined;
  return DRIVER_OPTION_BY_VALUE[driver as ProviderKind];
}
