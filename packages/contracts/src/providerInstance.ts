/**
 * Provider-instance contracts.
 *
 * Splits the historical "provider kind" concept into two:
 *
 *   - `ProviderDriverId` is the implementation kind selector (e.g. codex,
 *     claudeAgent, a fork's `ollama`, …). It picks which driver package
 *     handles the protocol, the probe, the adapter, and text generation.
 *
 *   - `ProviderInstanceId` is the routing key (a user-defined slug).
 *     Threads, sessions, runtime events, and persisted bindings reference
 *     instance ids — never driver ids — so a user can configure multiple
 *     instances of the same driver (e.g. `codex_personal` + `codex_work`),
 *     each with independent driver-specific configuration.
 *
 * Forward/backward compatibility invariant
 * ----------------------------------------
 * `ProviderDriverId` is intentionally an **open** branded slug, not a closed
 * literal union. The server hosts forks, ships in PRs that add drivers, and
 * users frequently roll between branches and forks. Any of those paths can
 * leave `ServerSettings`, persisted thread state, or session bindings
 * referencing a driver that the currently-running build does not know about.
 *
 * The rule: parsing any of those payloads must always succeed, and the
 * runtime is responsible for marking the unknown driver/instance as
 * "unavailable" rather than crashing. Built-in drivers shipped by the core
 * product are listed in `BUILT_IN_DRIVER_IDS`; that array is reference data
 * for defaults and presentation only — never a validation gate.
 *
 * Driver-specific configuration is similarly opaque at the contracts layer:
 * drivers live in (or will be extracted to) their own packages and own their
 * config schemas. The contracts package only knows the envelope.
 *
 * @module providerInstance
 */
import { Schema } from "effect";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";

const PROVIDER_SLUG_MAX_CHARS = 64;
/**
 * Slug pattern shared by driver ids and instance ids — letters, digits,
 * dashes, underscores. The first character must be a letter so ids remain
 * JS-identifier friendly when used as object keys, log fields, or telemetry
 * attributes. Mixed case is permitted so the historical driver ids (e.g.
 * `claudeAgent`) can be used verbatim during the migration and so external
 * fork authors retain reasonable freedom.
 */
const PROVIDER_SLUG_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

const slugSchema = TrimmedNonEmptyString.check(
  Schema.isMaxLength(PROVIDER_SLUG_MAX_CHARS),
  Schema.isPattern(PROVIDER_SLUG_PATTERN),
);

/**
 * `ProviderDriverId` — open branded slug naming a driver implementation.
 *
 * Constraints (validated at the schema layer):
 *   - starts with a letter
 *   - only letters, digits, `-`, `_` after the first char
 *   - 1..64 characters
 *
 * Notably **not** validated: that the driver is one we know how to load.
 * That check belongs to the runtime registry, which downgrades unknown
 * drivers gracefully (see module docs).
 */
export const ProviderDriverId = slugSchema.pipe(Schema.brand("ProviderDriverId"));
export type ProviderDriverId = typeof ProviderDriverId.Type;

/**
 * `ProviderInstanceId` — user-defined routing key for a configured provider
 * instance. Same slug rules as `ProviderDriverId`; branded separately so the
 * type system cannot confuse the two.
 */
export const ProviderInstanceId = slugSchema.pipe(Schema.brand("ProviderInstanceId"));
export type ProviderInstanceId = typeof ProviderInstanceId.Type;

/**
 * Built-in driver ids shipped by the core product. Reference data for
 * defaults, presentation, and migration shims — **not** a validation gate.
 * Forks and downgrades will encounter driver ids outside this list and the
 * system must still operate.
 */
export const BuiltInDriverId = Schema.Literals(["codex", "claudeAgent", "cursor", "opencode"]);
export type BuiltInDriverId = typeof BuiltInDriverId.Type;

/**
 * Legacy name for `BuiltInDriverId`, retained as a pure naming alias for the
 * duration of the driver/instance migration. Historically this was the
 * closed literal union that typed the `provider` field on model selections
 * and provider snapshots. Structurally identical to `BuiltInDriverId` — new
 * code should reference `BuiltInDriverId` (for the closed subset) or
 * `ProviderDriverId` (for any open driver slug) directly.
 *
 * @deprecated use `BuiltInDriverId` or `ProviderDriverId` instead.
 */
export const ProviderKind = BuiltInDriverId;
export type ProviderKind = BuiltInDriverId;

/**
 * Default built-in driver id used for first-boot fallbacks and round-trip
 * placeholders. Previously exported as `DEFAULT_PROVIDER_KIND` from
 * `orchestration.ts`; kept under the new name and re-exported under the old
 * name for migration compatibility.
 */
export const DEFAULT_BUILT_IN_DRIVER_ID: BuiltInDriverId = "codex";
/** @deprecated use `DEFAULT_BUILT_IN_DRIVER_ID`. */
export const DEFAULT_PROVIDER_KIND: BuiltInDriverId = DEFAULT_BUILT_IN_DRIVER_ID;

/**
 * Predicate identifying driver ids the core product ships with. Used by the
 * server to decide whether to instantiate a built-in driver vs. surface
 * "driver not installed" in the UI.
 */
export const isBuiltInDriverId = Schema.is(BuiltInDriverId);

/**
 * Lightweight reference identifying which driver implements an instance.
 * Carried alongside `ProviderInstanceId` on wire shapes so consumers can
 * branch on driver behavior (icons, capabilities, presentation) without
 * having to look up the instance in the registry.
 */
export const ProviderInstanceRef = Schema.Struct({
  instanceId: ProviderInstanceId,
  driver: ProviderDriverId,
});
export type ProviderInstanceRef = typeof ProviderInstanceRef.Type;

/**
 * Envelope shape for a provider instance configuration in `ServerSettings`.
 *
 * `driver` is intentionally accepted as any well-formed slug (see module
 * docs). The driver-specific config payload is left as `Schema.Unknown`;
 * each driver registers its own decoder with the runtime registry, and
 * envelopes for unknown drivers are preserved verbatim so they round-trip
 * across version changes without data loss.
 */
export const ProviderInstanceConfig = Schema.Struct({
  driver: ProviderDriverId,
  displayName: Schema.optional(TrimmedNonEmptyString),
  enabled: Schema.optionalKey(Schema.Boolean),
  config: Schema.optionalKey(Schema.Unknown),
});
export type ProviderInstanceConfig = typeof ProviderInstanceConfig.Type;

/**
 * Map shape for `ServerSettings.providerInstances`. Keyed by
 * `ProviderInstanceId`, values are envelopes the registry feeds to drivers.
 */
export const ProviderInstanceConfigMap = Schema.Record(ProviderInstanceId, ProviderInstanceConfig);
export type ProviderInstanceConfigMap = typeof ProviderInstanceConfigMap.Type;

/**
 * Construct the canonical `ProviderInstanceId` used as a back-compat default
 * for a built-in driver. The legacy single-instance-per-driver world used
 * the driver id itself as the instance id; preserving that mapping keeps
 * existing persisted threads, bindings, and cache files routable across the
 * migration without rewriting their stored selection payloads.
 */
export const defaultInstanceIdForDriver = (driver: ProviderDriverId): ProviderInstanceId =>
  ProviderInstanceId.make(driver);
