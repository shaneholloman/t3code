/**
 * CursorDriver — `ProviderDriver` for the Cursor Agent (`agent`) runtime.
 *
 * Cursor exposes an ACP-based CLI. The driver is still a plain value, but
 * its snapshot uses `makeManagedServerProvider`'s optional `enrichSnapshot`
 * hook to run the slow ACP model-capability probe in the background without
 * blocking the initial `ready`-state publish.
 *
 * Text generation is supported via the ACP runtime — `makeCursorTextGeneration`
 * drives `runtime.prompt` with a structured-output schema and collects the
 * agent's `agent_message_chunk` stream into a single JSON blob.
 *
 * @module provider/Drivers/CursorDriver
 */
import { CursorSettings, ProviderDriverId, type ServerProvider } from "@t3tools/contracts";
import { Duration, Effect, FileSystem, Path, Schema, Stream } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";

import { ServerConfig } from "../../config.ts";
import { makeCursorTextGeneration } from "../../git/Layers/CursorTextGeneration.ts";
import { ProviderDriverError } from "../Errors.ts";
import { makeCursorAdapter } from "../Layers/CursorAdapter.ts";
import {
  buildInitialCursorProviderSnapshot,
  checkCursorProviderStatus,
  enrichCursorSnapshot,
} from "../Layers/CursorProvider.ts";
import { ProviderEventLoggers } from "../Layers/ProviderEventLoggers.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import type { ProviderDriver, ProviderInstance } from "../ProviderDriver.ts";

const DRIVER_ID = ProviderDriverId.make("cursor");
const SNAPSHOT_REFRESH_INTERVAL = Duration.minutes(5);

export type CursorDriverEnv =
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | Path.Path
  | ProviderEventLoggers
  | ServerConfig;

const withInstanceIdentity =
  (instanceId: ProviderInstance["instanceId"]) =>
  (snapshot: ServerProvider): ServerProvider => ({
    ...snapshot,
    instanceId,
    driver: DRIVER_ID,
  });

export const CursorDriver: ProviderDriver<CursorSettings, CursorDriverEnv> = {
  driverId: DRIVER_ID,
  metadata: {
    displayName: "Cursor",
    supportsMultipleInstances: true,
  },
  configSchema: CursorSettings,
  defaultConfig: (): CursorSettings => Schema.decodeSync(CursorSettings)({}),
  create: ({ instanceId, displayName, enabled, config }) =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const eventLoggers = yield* ProviderEventLoggers;
      const stampIdentity = withInstanceIdentity(instanceId);

      const adapter = yield* makeCursorAdapter(config, {
        ...(eventLoggers.native ? { nativeEventLogger: eventLoggers.native } : {}),
        instanceId,
      });
      const textGeneration = yield* makeCursorTextGeneration(config);

      const checkProvider = checkCursorProviderStatus(config).pipe(
        Effect.map(stampIdentity),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      );

      const snapshot = yield* makeManagedServerProvider<CursorSettings>({
        getSettings: Effect.succeed(config),
        streamSettings: Stream.never,
        haveSettingsChanged: () => false,
        initialSnapshot: (settings) => stampIdentity(buildInitialCursorProviderSnapshot(settings)),
        checkProvider,
        // Preserve the background ACP model-capability probe that used to
        // live on `CursorProviderLive`. Only fires when the snapshot reports
        // an authenticated, enabled provider with at least one non-custom
        // model whose capabilities haven't been captured yet.
        enrichSnapshot: ({ settings, snapshot: currentSnapshot, publishSnapshot }) =>
          enrichCursorSnapshot({
            settings,
            snapshot: currentSnapshot,
            publishSnapshot,
            stampIdentity,
          }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner)),
        refreshInterval: SNAPSHOT_REFRESH_INTERVAL,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_ID,
              instanceId,
              detail: `Failed to build Cursor snapshot: ${cause.message ?? String(cause)}`,
              cause,
            }),
        ),
      );

      return {
        instanceId,
        driverId: DRIVER_ID,
        displayName,
        enabled,
        snapshot,
        adapter,
        textGeneration,
      } satisfies ProviderInstance;
    }),
};
