"use client";

import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ProviderInstanceId,
  type ProviderDriverId,
  type ProviderInstanceConfig,
  type ProviderKind,
} from "@t3tools/contracts";

import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { RadioGroup } from "../ui/radio-group";
import { toastManager } from "../ui/toast";
import { DRIVER_OPTION_BY_VALUE, DRIVER_OPTIONS } from "./providerDriverMeta";

/**
 * Normalize a user-provided label into a slug suffix for the instance id.
 * The full id is formed by prefixing the driver slug — e.g. label "Work" on
 * driver "codex" becomes `codex_work`. Output is trimmed to 48 chars so the
 * final composed id stays under the 64-char slug cap enforced by
 * `ProviderInstanceId` in `@t3tools/contracts`.
 */
function slugifyLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

function deriveInstanceId(driver: ProviderKind, label: string): string {
  const slug = slugifyLabel(label);
  return slug ? `${driver}_${slug}` : "";
}

const INSTANCE_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

/**
 * Validate an instance id against the same slug rules the server applies in
 * `ProviderInstanceId` (see `packages/contracts/src/providerInstance.ts`).
 * Returns a user-facing error string, or `null` if valid.
 */
function validateInstanceId(id: string, existing: ReadonlySet<string>): string | null {
  if (id.length === 0) return "Instance ID is required.";
  if (id.length > 64) return "Instance ID must be 64 characters or fewer.";
  if (!INSTANCE_ID_PATTERN.test(id)) {
    return "Instance ID must start with a letter and use only letters, digits, '-', or '_'.";
  }
  if (existing.has(id)) return `An instance named '${id}' already exists.`;
  return null;
}

interface AddProviderInstanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddProviderInstanceDialog({ open, onOpenChange }: AddProviderInstanceDialogProps) {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();

  const [driver, setDriver] = useState<ProviderKind>("codex");
  const [label, setLabel] = useState("");
  const [instanceId, setInstanceId] = useState("");
  const [instanceIdDirty, setInstanceIdDirty] = useState(false);
  // Driver-specific field values keyed by `${driver}:${fieldKey}` so toggling
  // between drivers during the same dialog session doesn't lose in-progress
  // input. Only the active driver's values are persisted on save.
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  // Errors are suppressed until the user has tried to submit once. After that
  // they update live so fixing the problem clears the message in place.
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  const existingIds = useMemo(
    () => new Set(Object.keys(settings.providerInstances ?? {})),
    [settings.providerInstances],
  );

  // Reset the form every time the dialog opens so each creation starts
  // from a clean slate.
  useEffect(() => {
    if (!open) return;
    setDriver("codex");
    setLabel("");
    setInstanceId("");
    setInstanceIdDirty(false);
    setFieldValues({});
    setHasAttemptedSubmit(false);
  }, [open]);

  // Auto-derive the instance id from driver + label until the user types
  // in the Instance ID field directly (after which they own its value).
  useEffect(() => {
    if (instanceIdDirty) return;
    setInstanceId(deriveInstanceId(driver, label));
  }, [driver, label, instanceIdDirty]);

  const driverOption = DRIVER_OPTION_BY_VALUE[driver];
  const instanceIdError = validateInstanceId(instanceId, existingIds);
  const showInstanceIdError = hasAttemptedSubmit && instanceIdError !== null;

  const getFieldValue = useCallback(
    (fieldKey: string) => fieldValues[`${driver}:${fieldKey}`] ?? "",
    [driver, fieldValues],
  );

  const setFieldValue = useCallback(
    (fieldKey: string, value: string) => {
      setFieldValues((existing) => ({ ...existing, [`${driver}:${fieldKey}`]: value }));
    },
    [driver],
  );

  const handleSave = useCallback(() => {
    setHasAttemptedSubmit(true);
    if (instanceIdError !== null) return;

    // Build the config blob from non-empty driver-specific field values.
    // Empty strings are dropped so defaults remain in effect on the server.
    const config: Record<string, string> = {};
    for (const field of driverOption.fields) {
      const value = (fieldValues[`${driver}:${field.key}`] ?? "").trim();
      if (value.length > 0) config[field.key] = value;
    }
    const hasConfig = Object.keys(config).length > 0;

    const nextInstance: ProviderInstanceConfig = {
      driver: driver as ProviderDriverId,
      enabled: true,
      ...(label.trim().length > 0 ? { displayName: label.trim() } : {}),
      ...(hasConfig ? { config } : {}),
    };
    // `ProviderInstanceId.make` revalidates the slug; we've already checked
    // it via `validateInstanceId`, but going through the brand constructor
    // keeps the type boundary honest and guards against any future drift in
    // the slug rules.
    const brandedId = ProviderInstanceId.make(instanceId);
    const nextMap = {
      ...settings.providerInstances,
      [brandedId]: nextInstance,
    };
    try {
      updateSettings({ providerInstances: nextMap });
      toastManager.add({
        type: "success",
        title: "Provider instance added",
        description: `${driverOption.label} instance '${instanceId}' was added.`,
      });
      onOpenChange(false);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not add provider instance",
        description: error instanceof Error ? error.message : "Update failed.",
      });
    }
  }, [
    driver,
    driverOption,
    fieldValues,
    instanceId,
    instanceIdError,
    label,
    onOpenChange,
    settings.providerInstances,
    updateSettings,
  ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add provider instance</DialogTitle>
          <DialogDescription>
            Configure an additional provider instance — for example, a second Codex install pointed
            at a different workspace. Sessions opened against this instance will use the
            configuration below.
          </DialogDescription>
        </DialogHeader>

        <DialogPanel className="space-y-4">
          <div className="grid gap-1.5">
            <span id="add-instance-driver-label" className="text-xs font-medium text-foreground">
              Driver
            </span>
            <RadioGroup
              value={driver}
              onValueChange={(value) => setDriver(value as ProviderKind)}
              aria-labelledby="add-instance-driver-label"
              className="grid grid-cols-2 gap-2"
            >
              {DRIVER_OPTIONS.map((option) => {
                const IconComponent = option.icon;
                const isSelected = option.value === driver;
                return (
                  <RadioPrimitive.Root
                    key={option.value}
                    value={option.value}
                    className={cn(
                      "relative flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left outline-none transition-[background-color,border-color,box-shadow]",
                      "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                      isSelected
                        ? "border-primary bg-primary/5 ring-1 ring-primary/40"
                        : "border-input bg-background hover:border-foreground/24 hover:bg-muted/40",
                    )}
                  >
                    <IconComponent className="size-5 shrink-0" aria-hidden />
                    <span className="text-sm font-medium text-foreground">{option.label}</span>
                  </RadioPrimitive.Root>
                );
              })}
            </RadioGroup>
          </div>

          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">Label</span>
            <Input
              placeholder="e.g. Work"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
            <span className="text-[11px] text-muted-foreground">
              Shown in the provider list. Optional.
            </span>
          </label>

          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">Instance ID</span>
            <Input
              placeholder={`${driver}_work`}
              value={instanceId}
              onChange={(event) => {
                setInstanceIdDirty(true);
                setInstanceId(event.target.value);
              }}
              aria-invalid={showInstanceIdError}
            />
            {showInstanceIdError ? (
              <span className="text-[11px] text-destructive">{instanceIdError}</span>
            ) : (
              <span className="text-[11px] text-muted-foreground">
                Routing key used by threads and sessions. Letters, digits, '-', or '_'.
              </span>
            )}
          </label>

          {driverOption.fields.length > 0 ? (
            <div className="space-y-4 border-t border-border/60 pt-4">
              <div className="text-xs font-medium text-foreground">
                {driverOption.label} configuration
              </div>
              {driverOption.fields.map((field) => (
                <label key={field.key} className="grid gap-1.5">
                  <span className="text-xs font-medium text-foreground">{field.label}</span>
                  <Input
                    type={field.type === "password" ? "password" : undefined}
                    autoComplete={field.type === "password" ? "off" : undefined}
                    placeholder={field.placeholder}
                    value={getFieldValue(field.key)}
                    onChange={(event) => setFieldValue(field.key, event.target.value)}
                    spellCheck={false}
                  />
                  {field.description ? (
                    <span className="text-[11px] text-muted-foreground">{field.description}</span>
                  ) : null}
                </label>
              ))}
            </div>
          ) : null}
        </DialogPanel>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave}>
            Add instance
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
