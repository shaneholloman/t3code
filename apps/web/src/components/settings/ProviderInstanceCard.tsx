"use client";

import { ChevronDownIcon, Trash2Icon } from "lucide-react";
import {
  isBuiltInDriverId,
  type ProviderInstanceConfig,
  type ProviderInstanceId,
  type ProviderKind,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";

import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent } from "../ui/collapsible";
import { DraftInput } from "../ui/draft-input";
import { Switch } from "../ui/switch";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { DriverOption } from "./providerDriverMeta";
import { ProviderModelsSection } from "./ProviderModelsSection";
import {
  PROVIDER_STATUS_STYLES,
  getProviderSummary,
  getProviderVersionLabel,
  type ProviderStatusKey,
} from "./providerStatus";

/**
 * Read a string value at `key` from the opaque per-driver config blob.
 * Returns an empty string when the key is missing or the stored value is
 * not a string. The permissive shape reflects that `config` is
 * `Schema.Unknown` at the contract boundary — forks may populate it with
 * non-string values that the built-in UI should round-trip without
 * throwing.
 */
function readConfigString(config: unknown, key: string): string {
  if (config === null || typeof config !== "object") return "";
  const value = (config as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

/**
 * Read a string[] at `key` from the opaque config blob, filtering out
 * non-string entries. Used for `customModels`, which is always typed as
 * `string[]` by the concrete driver schemas but arrives here as
 * `Schema.Unknown`.
 */
function readConfigStringArray(config: unknown, key: string): ReadonlyArray<string> {
  if (config === null || typeof config !== "object") return [];
  const value = (config as Record<string, unknown>)[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

/**
 * Produce the next config blob after setting `key` to `value`. Empty
 * strings drop the key so server defaults stay in effect, mirroring the
 * save-time normalization in `AddProviderInstanceDialog`. Returns
 * `undefined` when the resulting blob has no keys, which matches
 * `ProviderInstanceConfig.config` being optional.
 *
 * Non-string values already stored in the blob are carried through
 * verbatim so fork-owned fields survive edits made through this UI.
 */
function nextConfigBlobWithString(
  config: unknown,
  key: string,
  value: string,
): Record<string, unknown> | undefined {
  const base: Record<string, unknown> =
    config !== null && typeof config === "object" ? { ...(config as Record<string, unknown>) } : {};
  const trimmed = value.trim();
  if (trimmed.length > 0) {
    base[key] = value;
  } else {
    delete base[key];
  }
  return Object.keys(base).length > 0 ? base : undefined;
}

/**
 * Set `key` to an arbitrary value on the opaque config blob. Unlike
 * `nextConfigBlobWithString`, does not drop empty-looking values — the
 * caller is responsible for deciding whether an empty array / empty
 * object should be stored explicitly (e.g. `customModels: []` is a
 * meaningful "user cleared their custom list" state distinct from
 * "driver default").
 */
function nextConfigBlobWithValue(
  config: unknown,
  key: string,
  value: unknown,
): Record<string, unknown> {
  const base: Record<string, unknown> =
    config !== null && typeof config === "object" ? { ...(config as Record<string, unknown>) } : {};
  base[key] = value;
  return base;
}

interface ProviderInstanceCardProps {
  readonly instanceId: ProviderInstanceId;
  readonly instance: ProviderInstanceConfig;
  readonly driverOption: DriverOption | undefined;
  readonly liveProvider: ServerProvider | undefined;
  readonly isExpanded: boolean;
  readonly onExpandedChange: (open: boolean) => void;
  readonly onUpdate: (nextInstance: ProviderInstanceConfig) => void;
  /**
   * Pass `undefined` to hide the delete button entirely. Built-in default
   * instance slots use `undefined` — they can't be deleted without losing
   * the slot, and their "reset to defaults" affordance lives on an outer
   * reset button instead. Explicit `| undefined` in the type accommodates
   * `exactOptionalPropertyTypes: true`, where an absent key and
   * `{ onDelete: undefined }` are treated as distinct shapes.
   */
  readonly onDelete?: (() => void) | undefined;
  /**
   * Optional outer reset button rendered next to the driver icon. Built-in
   * default slots supply a reset-to-factory control here; custom instances
   * omit it.
   */
  readonly headerAction?: React.ReactNode | undefined;
}

/**
 * A single configured provider-instance row in the Providers settings
 * section. Used for every row — both the built-in default instance for a
 * driver (rendered with `onDelete` omitted) and user-authored custom
 * instances (`onDelete` supplied). The only UI difference between the two
 * is whether the trash button is visible; every other field (display
 * name, config fields, models) behaves identically.
 *
 * Behavior notes:
 *   - `liveProvider` is matched by the caller via `instanceId`; when no
 *     match is available (e.g. the server hasn't probed yet, or the
 *     driver is not shipped by the current build) the card still renders
 *     with a neutral "checking" summary.
 *   - Unknown drivers (`driverOption === undefined`) get a read-only
 *     notice instead of editable fields, so fork instances round-trip
 *     without accidentally destroying their config.
 *   - The enabled Switch writes to the envelope's `instance.enabled`
 *     field; the server's registry consults this at `entry.enabled ?? true`
 *     before materializing the instance, and the probe also checks its
 *     driver-specific `config.enabled`. We treat the envelope flag as the
 *     single source of truth from the UI — built-in cards used to write
 *     the inner flag, but on the promotion-to-instance path every edit
 *     flows through the envelope.
 */
export function ProviderInstanceCard({
  instanceId,
  instance,
  driverOption,
  liveProvider,
  isExpanded,
  onExpandedChange,
  onUpdate,
  onDelete,
  headerAction,
}: ProviderInstanceCardProps) {
  const enabled = instance.enabled ?? true;
  // The server-reported status wins when present; otherwise fall back to
  // "disabled"/"warning" based on the local `enabled` flag so the dot
  // reflects the persisted intent even before the first probe completes.
  const statusKey: ProviderStatusKey =
    (liveProvider?.status as ProviderStatusKey | undefined) ?? (enabled ? "warning" : "disabled");
  const statusStyle = PROVIDER_STATUS_STYLES[statusKey];
  const summary = getProviderSummary(liveProvider);
  const versionLabel = getProviderVersionLabel(liveProvider?.version);
  const IconComponent = driverOption?.icon;
  const displayName =
    instance.displayName?.trim() || driverOption?.label || String(instance.driver);

  // Narrow `instance.driver` for callers that key on the closed
  // `ProviderKind` union (e.g. `normalizeModelSlug`'s alias table). Custom
  // fork drivers pass through as `null` and those callers fall back to
  // verbatim behaviour.
  const driverKind: ProviderKind | null = isBuiltInDriverId(instance.driver)
    ? instance.driver
    : null;

  const customModels = readConfigStringArray(instance.config, "customModels");
  // Show live probe models when available; otherwise synthesize from the
  // persisted customModels so the user can see what they've added even
  // before the first probe completes.
  const modelsForDisplay: ReadonlyArray<ServerProviderModel> =
    liveProvider?.models ??
    customModels.map((slug) => ({
      slug,
      name: slug,
      isCustom: true,
      capabilities: null,
    }));

  const updateDisplayName = (value: string) => {
    const trimmed = value.trim();
    const { displayName: _omit, ...rest } = instance;
    onUpdate(
      trimmed.length > 0
        ? ({ ...rest, displayName: trimmed } as ProviderInstanceConfig)
        : (rest as ProviderInstanceConfig),
    );
  };

  const updateEnabled = (value: boolean) => {
    onUpdate({ ...instance, enabled: value });
  };

  const updateConfigField = (key: string, value: string) => {
    const nextConfig = nextConfigBlobWithString(instance.config, key, value);
    const { config: _omit, ...rest } = instance;
    onUpdate(
      nextConfig !== undefined
        ? ({ ...rest, config: nextConfig } as ProviderInstanceConfig)
        : (rest as ProviderInstanceConfig),
    );
  };

  const updateCustomModels = (next: ReadonlyArray<string>) => {
    const nextConfig = nextConfigBlobWithValue(instance.config, "customModels", [...next]);
    const { config: _omit, ...rest } = instance;
    onUpdate({ ...rest, config: nextConfig } as ProviderInstanceConfig);
  };

  return (
    <div className="border-t border-border first:border-t-0">
      <div className="px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex min-h-5 items-center gap-1.5">
              <span className={cn("size-2 shrink-0 rounded-full", statusStyle.dot)} />
              {IconComponent ? (
                <IconComponent className="size-4 shrink-0 text-foreground/80" aria-hidden />
              ) : null}
              <h3 className="truncate text-sm font-medium text-foreground">{displayName}</h3>
              {String(instanceId) !== String(instance.driver) ? (
                // Hide the id chip on a default slot whose id === the
                // driver slug — it's redundant with the driver icon +
                // label. Custom instances (and any instance the user has
                // since renamed) keep the chip so their slug stays
                // visible for copy/paste + disambiguation.
                <code className="truncate rounded bg-muted/60 px-1 py-0.5 text-[10px] text-muted-foreground">
                  {instanceId}
                </code>
              ) : null}
              {driverOption?.badgeLabel ? (
                <Badge variant="warning" size="sm" className="shrink-0">
                  {driverOption.badgeLabel}
                </Badge>
              ) : null}
              {versionLabel ? (
                <code className="text-xs text-muted-foreground">{versionLabel}</code>
              ) : null}
              {headerAction ? (
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
                  {headerAction}
                </span>
              ) : null}
              {onDelete ? (
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          className="size-5 rounded-sm p-0 text-muted-foreground hover:text-destructive"
                          onClick={onDelete}
                          aria-label={`Delete provider instance ${instanceId}`}
                        >
                          <Trash2Icon className="size-3" />
                        </Button>
                      }
                    />
                    <TooltipPopup side="top">Delete instance</TooltipPopup>
                  </Tooltip>
                </span>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              {summary.headline}
              {summary.detail ? ` - ${summary.detail}` : null}
            </p>
          </div>
          <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto sm:justify-end">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => onExpandedChange(!isExpanded)}
              aria-label={`Toggle ${displayName} details`}
            >
              <ChevronDownIcon
                className={cn("size-3.5 transition-transform", isExpanded && "rotate-180")}
              />
            </Button>
            <Switch
              checked={enabled}
              onCheckedChange={(checked) => updateEnabled(Boolean(checked))}
              aria-label={`Enable ${displayName}`}
            />
          </div>
        </div>
      </div>

      <Collapsible open={isExpanded} onOpenChange={onExpandedChange}>
        <CollapsibleContent>
          <div className="space-y-0">
            <div className="border-t border-border/60 px-4 py-3 sm:px-5">
              <label htmlFor={`provider-instance-${instanceId}-display-name`} className="block">
                <span className="text-xs font-medium text-foreground">Display name</span>
                <DraftInput
                  id={`provider-instance-${instanceId}-display-name`}
                  className="mt-1.5"
                  value={instance.displayName ?? ""}
                  onCommit={updateDisplayName}
                  placeholder={driverOption?.label ?? "Instance label"}
                  spellCheck={false}
                />
                <span className="mt-1 block text-xs text-muted-foreground">
                  Optional label shown in the provider list.
                </span>
              </label>
            </div>

            {driverOption?.fields.map((field) => (
              <div key={field.key} className="border-t border-border/60 px-4 py-3 sm:px-5">
                <label htmlFor={`provider-instance-${instanceId}-${field.key}`} className="block">
                  <span className="text-xs font-medium text-foreground">{field.label}</span>
                  <DraftInput
                    id={`provider-instance-${instanceId}-${field.key}`}
                    className="mt-1.5"
                    type={field.type === "password" ? "password" : undefined}
                    autoComplete={field.type === "password" ? "off" : undefined}
                    value={readConfigString(instance.config, field.key)}
                    onCommit={(next) => updateConfigField(field.key, next)}
                    placeholder={field.placeholder}
                    spellCheck={false}
                  />
                  {field.description ? (
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {field.description}
                    </span>
                  ) : null}
                </label>
              </div>
            ))}

            {driverOption !== undefined ? (
              <ProviderModelsSection
                instanceId={instanceId}
                driverKind={driverKind}
                models={modelsForDisplay}
                customModels={customModels}
                onChange={updateCustomModels}
              />
            ) : (
              <div className="border-t border-border/60 px-4 py-3 sm:px-5">
                <p className="text-xs text-muted-foreground">
                  This instance uses a driver (
                  <code className="text-foreground">{String(instance.driver)}</code>) that is not
                  shipped with the current build. Configuration values are preserved but cannot be
                  edited from this surface.
                </p>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
