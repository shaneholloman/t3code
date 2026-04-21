"use client";

import { InfoIcon, PlusIcon, XIcon } from "lucide-react";
import { useRef, useState } from "react";
import type {
  ProviderInstanceId,
  ProviderKind,
  ServerProviderModel,
} from "@t3tools/contracts";
import { normalizeModelSlug } from "@t3tools/shared/model";

import { MAX_CUSTOM_MODEL_LENGTH } from "../../modelSelection";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * Placeholder text for the "add a custom model" input, keyed by driver
 * kind. Mirrors the prior hardcoded switch in `SettingsPanels.tsx` so the
 * UX is unchanged — only the owning component has moved.
 */
const CUSTOM_MODEL_PLACEHOLDER_BY_KIND: Record<ProviderKind, string> = {
  codex: "gpt-6.7-codex-ultra-preview",
  claudeAgent: "claude-sonnet-5-0",
  cursor: "claude-sonnet-4-6",
  opencode: "openai/gpt-5",
};

interface ProviderModelsSectionProps {
  /** Identifier used to namespace input ids within the DOM. */
  readonly instanceId: ProviderInstanceId;
  /**
   * Narrowed driver kind for slug normalization + input placeholder. `null`
   * when the instance uses a fork/unknown driver — the section renders
   * read-only (no add input) in that case.
   */
  readonly driverKind: ProviderKind | null;
  /**
   * The live model list to display. Includes both built-in (probe-reported)
   * and custom entries, distinguished by `isCustom`.
   */
  readonly models: ReadonlyArray<ServerProviderModel>;
  /**
   * The persisted custom-model slug list for this instance. Drives dedup,
   * and is the array we hand back verbatim (with the new slug appended /
   * removed) via `onChange`.
   */
  readonly customModels: ReadonlyArray<string>;
  /**
   * Commit the new custom-model list. Caller is responsible for routing the
   * write to the correct storage (legacy `settings.providers[kind]` vs.
   * `providerInstances[id].config`).
   */
  readonly onChange: (next: ReadonlyArray<string>) => void;
}

/**
 * Shared "Models" section rendered on both the built-in default and custom
 * provider-instance cards. Owns its own input + error local state so two
 * cards on screen don't fight over the input value.
 *
 * Validation mirrors the pre-consolidation logic in `SettingsPanels`:
 *   - empty / whitespace → "Enter a model slug."
 *   - duplicate of a non-custom (probe-reported) slug → "already built in"
 *   - exceeds `MAX_CUSTOM_MODEL_LENGTH` → length error
 *   - duplicate of an already-saved custom slug → already-saved error
 */
export function ProviderModelsSection({
  instanceId,
  driverKind,
  models,
  customModels,
  onChange,
}: ProviderModelsSectionProps) {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const handleAdd = () => {
    // Unknown fork drivers don't go through `normalizeModelSlug` (the
    // alias tables are keyed by closed `ProviderKind`), so keep the
    // verbatim trimmed slug for forks. Built-in drivers still get alias
    // rewrites ("sonnet" → "claude-sonnet-4-6" etc).
    const normalized = driverKind
      ? normalizeModelSlug(input, driverKind)
      : input.trim() || null;
    if (!normalized) {
      setError("Enter a model slug.");
      return;
    }
    if (models.some((model) => !model.isCustom && model.slug === normalized)) {
      setError("That model is already built in.");
      return;
    }
    if (normalized.length > MAX_CUSTOM_MODEL_LENGTH) {
      setError(`Model slugs must be ${MAX_CUSTOM_MODEL_LENGTH} characters or less.`);
      return;
    }
    if (customModels.includes(normalized)) {
      setError("That custom model is already saved.");
      return;
    }

    onChange([...customModels, normalized]);
    setInput("");
    setError(null);

    // Scroll the new row into view once the DOM reflects the commit.
    // `MutationObserver` handles the one-frame gap between `onChange` and
    // the `models` prop update; the `requestAnimationFrame` covers the
    // common case where the parent updates synchronously.
    const el = listRef.current;
    if (!el) return;
    const scrollToEnd = () => el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    requestAnimationFrame(scrollToEnd);
    const observer = new MutationObserver(() => {
      scrollToEnd();
      observer.disconnect();
    });
    observer.observe(el, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 2_000);
  };

  const handleRemove = (slug: string) => {
    onChange(customModels.filter((model) => model !== slug));
    setError(null);
  };

  return (
    <div className="border-t border-border/60 px-4 py-3 sm:px-5">
      <div className="text-xs font-medium text-foreground">Models</div>
      <div className="mt-1 text-xs text-muted-foreground">
        {models.length} model{models.length === 1 ? "" : "s"} available.
      </div>
      <div ref={listRef} className="mt-2 max-h-40 overflow-y-auto pb-1">
        {models.map((model) => {
          const caps = model.capabilities;
          const capLabels: string[] = [];
          const descriptors = caps?.optionDescriptors ?? [];
          if (descriptors.some((descriptor) => descriptor.id === "fastMode")) {
            capLabels.push("Fast mode");
          }
          if (descriptors.some((descriptor) => descriptor.id === "thinking")) {
            capLabels.push("Thinking");
          }
          if (
            descriptors.some(
              (descriptor) =>
                descriptor.type === "select" &&
                (descriptor.id === "reasoningEffort" ||
                  descriptor.id === "effort" ||
                  descriptor.id === "reasoning" ||
                  descriptor.id === "variant"),
            )
          ) {
            capLabels.push("Reasoning");
          }
          const hasDetails = capLabels.length > 0 || model.name !== model.slug;

          return (
            <div key={`${instanceId}:${model.slug}`} className="flex items-center gap-2 py-1">
              <span className="min-w-0 truncate text-xs text-foreground/90">{model.name}</span>
              {hasDetails ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        className="shrink-0 text-muted-foreground/40 transition-colors hover:text-muted-foreground"
                        aria-label={`Details for ${model.name}`}
                      />
                    }
                  >
                    <InfoIcon className="size-3" />
                  </TooltipTrigger>
                  <TooltipPopup side="top" className="max-w-56">
                    <div className="space-y-1">
                      <code className="block text-[11px] text-foreground">{model.slug}</code>
                      {capLabels.length > 0 ? (
                        <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                          {capLabels.map((label) => (
                            <span key={label} className="text-[10px] text-muted-foreground">
                              {label}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </TooltipPopup>
                </Tooltip>
              ) : null}
              {model.isCustom ? (
                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground">custom</span>
                  <button
                    type="button"
                    className="text-muted-foreground transition-colors hover:text-foreground"
                    aria-label={`Remove ${model.slug}`}
                    onClick={() => handleRemove(model.slug)}
                  >
                    <XIcon className="size-3" />
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Input
          id={`provider-instance-${instanceId}-custom-model`}
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            handleAdd();
          }}
          placeholder={driverKind ? CUSTOM_MODEL_PLACEHOLDER_BY_KIND[driverKind] : "model-slug"}
          spellCheck={false}
        />
        <Button className="shrink-0" variant="outline" onClick={handleAdd}>
          <PlusIcon className="size-3.5" />
          Add
        </Button>
      </div>

      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
