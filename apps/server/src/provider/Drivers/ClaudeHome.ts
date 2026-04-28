import os from "node:os";
import path from "node:path";

import type { ClaudeSettings } from "@t3tools/contracts";

import { expandHomePath } from "../../pathExpansion.ts";

const DEFAULT_CLAUDE_HOME = os.homedir();

export function resolveClaudeHomePath(config: Pick<ClaudeSettings, "homePath">): string {
  const homePath = config.homePath.trim();
  return path.resolve(homePath.length > 0 ? expandHomePath(homePath) : DEFAULT_CLAUDE_HOME);
}

export function makeClaudeEnvironment(
  config: Pick<ClaudeSettings, "homePath">,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const homePath = config.homePath.trim();
  if (homePath.length === 0) return baseEnv;
  return {
    ...baseEnv,
    HOME: resolveClaudeHomePath(config),
  };
}

export function makeClaudeContinuationGroupKey(config: Pick<ClaudeSettings, "homePath">): string {
  return `claude:home:${resolveClaudeHomePath(config)}`;
}

export function makeClaudeCapabilitiesCacheKey(
  config: Pick<ClaudeSettings, "binaryPath" | "homePath">,
): string {
  return `${config.binaryPath}\0${resolveClaudeHomePath(config)}`;
}
