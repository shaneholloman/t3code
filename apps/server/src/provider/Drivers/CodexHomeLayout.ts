import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ProviderDriverKind, type CodexSettings } from "@t3tools/contracts";
import { Effect, Schema } from "effect";

import { expandHomePath } from "../../pathExpansion.ts";

export interface CodexHomeLayout {
  readonly mode: "direct" | "authOverlay";
  readonly sharedHomePath: string;
  readonly effectiveHomePath: string | undefined;
  readonly continuationKey: string;
}

const DEFAULT_CODEX_HOME = path.join(os.homedir(), ".codex");

const KNOWN_SHARED_DIRECTORIES = [
  "sessions",
  "archived_sessions",
  "sqlite",
  "shell_snapshots",
  "worktrees",
  "skills",
  "plugins",
  "cache",
  "logs",
] as const;

const PRIVATE_ENTRY_NAMES = new Set(["auth.json", "models_cache.json"]);

function resolveHomePath(value: string | undefined): string {
  const expanded = value && value.trim().length > 0 ? expandHomePath(value) : DEFAULT_CODEX_HOME;
  return path.resolve(expanded);
}

export function resolveCodexHomeLayout(config: CodexSettings): CodexHomeLayout {
  const sharedHomePath = resolveHomePath(config.homePath);
  const shadowHomePath = config.shadowHomePath.trim();
  if (shadowHomePath.length === 0) {
    return {
      mode: "direct",
      sharedHomePath,
      effectiveHomePath: config.homePath.trim().length > 0 ? sharedHomePath : undefined,
      continuationKey: `codex:home:${sharedHomePath}`,
    };
  }

  const effectiveHomePath = path.resolve(expandHomePath(shadowHomePath));
  return {
    mode: "authOverlay",
    sharedHomePath,
    effectiveHomePath,
    continuationKey: `codex:home:${sharedHomePath}`,
  };
}

export class CodexShadowHomeError extends Schema.TaggedErrorClass<CodexShadowHomeError>()(
  "CodexShadowHomeError",
  {
    detail: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function removePrivateSymlink(input: {
  readonly shadowPath: string;
  readonly entryName: string;
}): Promise<void> {
  const privatePath = path.join(input.shadowPath, input.entryName);
  try {
    const stat = await fs.lstat(privatePath);
    if (stat.isSymbolicLink()) {
      await fs.unlink(privatePath);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

async function ensureSymlink(input: {
  readonly shadowPath: string;
  readonly sharedPath: string;
  readonly entryName: string;
}): Promise<void> {
  const target = path.join(input.sharedPath, input.entryName);
  const link = path.join(input.shadowPath, input.entryName);
  try {
    const stat = await fs.lstat(link);
    if (!stat.isSymbolicLink()) {
      throw new CodexShadowHomeError({
        detail: `Cannot create Codex shadow home because '${link}' already exists and is not a symlink.`,
      });
    }
    const existingTarget = await fs.readlink(link);
    const resolvedExisting = path.resolve(path.dirname(link), existingTarget);
    if (resolvedExisting !== target) {
      await fs.unlink(link);
      await fs.symlink(target, link);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    await fs.symlink(target, link);
  }
}

export const materializeCodexShadowHome = Effect.fn("materializeCodexShadowHome")(function* (
  layout: CodexHomeLayout,
) {
  if (layout.mode !== "authOverlay") return;
  if (!layout.effectiveHomePath) return;
  if (layout.sharedHomePath === layout.effectiveHomePath) {
    return yield* new CodexShadowHomeError({
      detail: "Codex shadow home path must be different from the shared home path.",
    });
  }

  yield* Effect.tryPromise({
    try: async () => {
      await fs.mkdir(layout.sharedHomePath, { recursive: true });
      await fs.mkdir(layout.effectiveHomePath!, { recursive: true });

      for (const dir of KNOWN_SHARED_DIRECTORIES) {
        await fs.mkdir(path.join(layout.sharedHomePath, dir), { recursive: true });
      }

      const entries = new Set<string>(KNOWN_SHARED_DIRECTORIES);
      for (const dirent of await fs.readdir(layout.sharedHomePath, { withFileTypes: true })) {
        if (!PRIVATE_ENTRY_NAMES.has(dirent.name)) {
          entries.add(dirent.name);
        }
      }

      for (const entryName of PRIVATE_ENTRY_NAMES) {
        if (entryName !== "auth.json") {
          await removePrivateSymlink({
            shadowPath: layout.effectiveHomePath!,
            entryName,
          });
        }
      }

      for (const entryName of entries) {
        if (PRIVATE_ENTRY_NAMES.has(entryName)) continue;
        await ensureSymlink({
          shadowPath: layout.effectiveHomePath!,
          sharedPath: layout.sharedHomePath,
          entryName,
        });
      }

      const authPath = path.join(layout.effectiveHomePath!, "auth.json");
      if (await pathExists(authPath)) {
        const authStat = await fs.lstat(authPath);
        if (authStat.isSymbolicLink()) {
          throw new CodexShadowHomeError({
            detail: `Codex shadow auth file '${authPath}' must be a real file, not a symlink.`,
          });
        }
      }
    },
    catch: (cause) =>
      Schema.is(CodexShadowHomeError)(cause)
        ? cause
        : new CodexShadowHomeError({
            detail: "Failed to materialize Codex shadow home.",
            cause,
          }),
  });
});

export function codexContinuationIdentity(config: CodexSettings) {
  const layout = resolveCodexHomeLayout(config);
  return {
    driverKind: ProviderDriverKind.make("codex"),
    continuationKey: layout.continuationKey,
  };
}
