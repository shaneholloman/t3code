import {
  isBuiltInDriverId,
  type ProviderDriverId,
  type ProviderInstanceConfig,
  type ProviderInstanceId,
  type ProviderKind,
  type ServerSettings,
  type UnifiedSettings,
} from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";

export function buildProviderInstanceUpdatePatch(input: {
  readonly settings: Pick<ServerSettings, "providers" | "providerInstances">;
  readonly instanceId: ProviderInstanceId;
  readonly instance: ProviderInstanceConfig;
  readonly driver: ProviderDriverId;
  readonly isDefault: boolean;
  readonly textGenerationModelSelection?:
    | ServerSettings["textGenerationModelSelection"]
    | undefined;
}): Partial<UnifiedSettings> {
  const shouldResetLegacyProvider = input.isDefault && isBuiltInDriverId(input.driver);
  return {
    ...(shouldResetLegacyProvider
      ? {
          providers: {
            ...input.settings.providers,
            [input.driver]: DEFAULT_UNIFIED_SETTINGS.providers[input.driver as ProviderKind],
          },
        }
      : {}),
    providerInstances: {
      ...input.settings.providerInstances,
      [input.instanceId]: input.instance,
    },
    ...(input.textGenerationModelSelection !== undefined
      ? { textGenerationModelSelection: input.textGenerationModelSelection }
      : {}),
  };
}
