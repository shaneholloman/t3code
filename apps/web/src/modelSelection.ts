import {
  DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER,
  defaultInstanceIdForDriver,
  type ModelSelection,
  ProviderDriverId,
  type ProviderInstanceId,
  type ProviderKind,
  type ServerProvider,
} from "@t3tools/contracts";
import {
  createModelSelection,
  normalizeModelSlug,
  resolveSelectableModel,
} from "@t3tools/shared/model";
import { getComposerProviderState } from "./components/chat/composerProviderState";
import { UnifiedSettings } from "@t3tools/contracts/settings";
import {
  getDefaultServerModel,
  getProviderModels,
  resolveSelectableProvider,
} from "./providerModels";
import { ModelEsque } from "./components/chat/providerIconUtils";
import {
  type ProviderInstanceEntry,
  deriveProviderInstanceEntries,
} from "./providerInstances";

const MAX_CUSTOM_MODEL_COUNT = 32;
export const MAX_CUSTOM_MODEL_LENGTH = 256;

/**
 * Resolve the custom-model list for a given instance, preferring the
 * instance's own `providerInstances[id].config.customModels` blob when
 * present and falling back to the legacy per-kind
 * `settings.providers[kind].customModels` bucket otherwise.
 *
 * The Settings UI promotes the legacy bucket into an explicit
 * `providerInstances[defaultId]` entry on every edit (the "migrate on
 * first write" scheme documented in
 * `ProviderInstanceRegistryHydration`), so this helper exists primarily
 * so readers pick up that promotion immediately — and so first-time
 * viewers on pre-migration settings still see their legacy list on
 * default slots. Custom instances today have no legacy counterpart, so
 * the fallback is effectively unreachable for non-default ids but kept
 * symmetric for clarity.
 */
function readInstanceCustomModels(
  settings: UnifiedSettings,
  instanceId: ProviderInstanceId,
  driverKind: ProviderKind,
): ReadonlyArray<string> {
  const instance = settings.providerInstances?.[instanceId];
  const config = instance?.config;
  if (config !== null && typeof config === "object") {
    const value = (config as Record<string, unknown>).customModels;
    if (Array.isArray(value)) {
      return value.filter((entry): entry is string => typeof entry === "string");
    }
  }
  return settings.providers[driverKind].customModels;
}

export interface AppModelOption {
  slug: string;
  name: string;
  shortName?: string;
  subProvider?: string;
  isCustom: boolean;
}

export function normalizeCustomModelSlugs(
  models: Iterable<string | null | undefined>,
  builtInModelSlugs: ReadonlySet<string>,
  provider: ProviderKind = "codex",
): string[] {
  const normalizedModels: string[] = [];
  const seen = new Set<string>();

  for (const candidate of models) {
    const normalized = normalizeModelSlug(candidate, provider);
    if (
      !normalized ||
      normalized.length > MAX_CUSTOM_MODEL_LENGTH ||
      builtInModelSlugs.has(normalized) ||
      seen.has(normalized)
    ) {
      continue;
    }

    seen.add(normalized);
    normalizedModels.push(normalized);
    if (normalizedModels.length >= MAX_CUSTOM_MODEL_COUNT) {
      break;
    }
  }

  return normalizedModels;
}

export function getAppModelOptions(
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
  provider: ProviderKind,
  selectedModel?: string | null,
): AppModelOption[] {
  const options: AppModelOption[] = getProviderModels(providers, provider).map(
    ({ slug, name, shortName, subProvider, isCustom }) => ({
      slug,
      name,
      ...(shortName ? { shortName } : {}),
      ...(subProvider ? { subProvider } : {}),
      isCustom,
    }),
  );
  const seen = new Set(options.map((option) => option.slug));
  const trimmedSelectedModel = selectedModel?.trim().toLowerCase();
  const builtInModelSlugs = new Set(
    getProviderModels(providers, provider)
      .filter((model) => !model.isCustom)
      .map((model) => model.slug),
  );

  // Read from the default instance's config first (that's where edits
  // now land), falling back to the legacy per-kind bucket so unmigrated
  // settings and the initial render before the first write both still
  // see the user's authored custom models.
  const defaultInstanceId = defaultInstanceIdForDriver(ProviderDriverId.make(provider));
  const customModels = readInstanceCustomModels(settings, defaultInstanceId, provider);
  for (const slug of normalizeCustomModelSlugs(customModels, builtInModelSlugs, provider)) {
    if (seen.has(slug)) {
      continue;
    }

    seen.add(slug);
    options.push({
      slug,
      name: slug,
      isCustom: true,
    });
  }

  const normalizedSelectedModel = normalizeModelSlug(selectedModel, provider);
  const selectedModelMatchesExistingName =
    typeof trimmedSelectedModel === "string" &&
    options.some((option) => option.name.toLowerCase() === trimmedSelectedModel);
  if (
    normalizedSelectedModel &&
    !seen.has(normalizedSelectedModel) &&
    !selectedModelMatchesExistingName
  ) {
    options.push({
      slug: normalizedSelectedModel,
      name: normalizedSelectedModel,
      isCustom: true,
    });
  }

  return options;
}

/**
 * Instance-scoped variant of {@link getAppModelOptions}. Built-in models
 * come from the instance's own `entry.models` snapshot (rather than the
 * first-matching-kind fallback in `getProviderModels`), so each custom
 * instance gets the precise model list its driver reported. Custom model
 * slugs come from the instance's own `providerInstances[id].config.customModels`
 * when present, falling back to the legacy per-kind
 * `settings.providers[driverKind].customModels` bucket — so a default
 * slot that hasn't yet migrated to the new storage still shows its
 * legacy list, and two instances of the same kind can now maintain
 * distinct custom-model lists.
 */
export function getAppModelOptionsForInstance(
  settings: UnifiedSettings,
  entry: ProviderInstanceEntry,
  selectedModel?: string | null,
): AppModelOption[] {
  const options: AppModelOption[] = entry.models.map(
    ({ slug, name, shortName, subProvider, isCustom }) => ({
      slug,
      name,
      ...(shortName ? { shortName } : {}),
      ...(subProvider ? { subProvider } : {}),
      isCustom,
    }),
  );
  const seen = new Set(options.map((option) => option.slug));
  const trimmedSelectedModel = selectedModel?.trim().toLowerCase();
  const builtInModelSlugs = new Set(
    entry.models.filter((model) => !model.isCustom).map((model) => model.slug),
  );

  const customModels = readInstanceCustomModels(settings, entry.instanceId, entry.driverKind);
  for (const slug of normalizeCustomModelSlugs(
    customModels,
    builtInModelSlugs,
    entry.driverKind,
  )) {
    if (seen.has(slug)) {
      continue;
    }

    seen.add(slug);
    options.push({ slug, name: slug, isCustom: true });
  }

  const normalizedSelectedModel = normalizeModelSlug(selectedModel, entry.driverKind);
  const selectedModelMatchesExistingName =
    typeof trimmedSelectedModel === "string" &&
    options.some((option) => option.name.toLowerCase() === trimmedSelectedModel);
  if (
    normalizedSelectedModel &&
    !seen.has(normalizedSelectedModel) &&
    !selectedModelMatchesExistingName
  ) {
    options.push({
      slug: normalizedSelectedModel,
      name: normalizedSelectedModel,
      isCustom: true,
    });
  }

  return options;
}

export function resolveAppModelSelection(
  provider: ProviderKind,
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
  selectedModel: string | null | undefined,
): string {
  const resolvedProvider = resolveSelectableProvider(providers, provider);
  const options = getAppModelOptions(settings, providers, resolvedProvider, selectedModel);
  return (
    resolveSelectableModel(resolvedProvider, selectedModel, options) ??
    getDefaultServerModel(providers, resolvedProvider)
  );
}

/**
 * Instance-keyed model options map. Each configured instance gets its own
 * option list so the model picker can show the same driver's built-in and
 * custom instances side by side without collapsing them.
 *
 * `selectedInstanceId` + `selectedModel` seed the "unknown slug as custom"
 * fallback on exactly one instance — the one the composer currently has
 * selected — so a persisted-but-unlisted slug still appears in its own
 * instance without leaking into sibling instances' option lists.
 */
export function getCustomModelOptionsByInstance(
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
  selectedInstanceId?: ProviderInstanceId | null,
  selectedModel?: string | null,
): ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>> {
  const out = new Map<ProviderInstanceId, ReadonlyArray<ModelEsque>>();
  for (const entry of deriveProviderInstanceEntries(providers)) {
    const carriesSelection = selectedInstanceId === entry.instanceId;
    out.set(
      entry.instanceId,
      getAppModelOptionsForInstance(settings, entry, carriesSelection ? selectedModel : undefined),
    );
  }
  return out;
}

export function resolveAppModelSelectionState(
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
): ModelSelection {
  const selection = settings.textGenerationModelSelection ?? {
    instanceId: "codex" as const,
    model: DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER.codex,
  };
  const provider = resolveSelectableProvider(providers, selection.instanceId);

  // When the provider changed due to fallback (e.g. selected provider was disabled),
  // don't carry over the old provider's model — use the fallback provider's default.
  const selectedModel = provider === selection.instanceId ? selection.model : null;
  const model = resolveAppModelSelection(provider, settings, providers, selectedModel);
  const { modelOptionsForDispatch } = getComposerProviderState({
    provider,
    model,
    models: getProviderModels(providers, provider),
    prompt: "",
    modelOptions: provider === selection.instanceId ? selection.options : undefined,
  });

  return createModelSelection(provider, model, modelOptionsForDispatch);
}
