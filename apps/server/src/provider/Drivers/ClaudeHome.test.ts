import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  makeClaudeCapabilitiesCacheKey,
  makeClaudeContinuationGroupKey,
  makeClaudeEnvironment,
  resolveClaudeHomePath,
} from "./ClaudeHome.ts";

describe("ClaudeHome", () => {
  it("uses the process home when no Claude home override is configured", () => {
    expect(resolveClaudeHomePath({ homePath: "" })).toBe(path.resolve(os.homedir()));
    expect(makeClaudeEnvironment({ homePath: "" })).toBe(process.env);
  });

  it("resolves configured Claude HOME and stamps continuation/cache keys with it", () => {
    const homePath = "~/.claude-work";
    const resolved = path.resolve(os.homedir(), ".claude-work");

    expect(resolveClaudeHomePath({ homePath })).toBe(resolved);
    expect(makeClaudeEnvironment({ homePath }).HOME).toBe(resolved);
    expect(makeClaudeContinuationGroupKey({ homePath })).toBe(`claude:home:${resolved}`);
    expect(makeClaudeCapabilitiesCacheKey({ binaryPath: "claude", homePath })).toBe(
      `claude\0${resolved}`,
    );
  });

  it("keeps continuation compatible across instances with the same Claude HOME", () => {
    const resolved = path.resolve(os.homedir());

    expect(makeClaudeContinuationGroupKey({ homePath: "" })).toBe(`claude:home:${resolved}`);
  });
});
