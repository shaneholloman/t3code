import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { CodexSettings } from "@t3tools/contracts";
import {
  materializeCodexShadowHome,
  resolveCodexHomeLayout,
  CodexShadowHomeError,
} from "./CodexHomeLayout.ts";

const decodeCodexSettings = (input: {
  readonly enabled?: boolean;
  readonly homePath?: string;
  readonly shadowHomePath?: string;
  readonly customModels?: readonly string[];
  readonly binaryPath?: string;
}): CodexSettings => Schema.decodeSync(CodexSettings)(input);

describe("CodexHomeLayout", () => {
  it("uses direct CODEX_HOME when no shadow home is configured", () => {
    const homePath = fs.mkdtempSync(path.join(os.tmpdir(), "t3code-codex-home-"));
    try {
      const layout = resolveCodexHomeLayout(
        decodeCodexSettings({
          homePath,
        }),
      );

      expect(layout).toMatchObject({
        mode: "direct",
        sharedHomePath: homePath,
        effectiveHomePath: homePath,
        continuationKey: `codex:home:${homePath}`,
      });
    } finally {
      fs.rmSync(homePath, { recursive: true, force: true });
    }
  });

  it("uses the shared home for continuation and the shadow home for runtime", () => {
    const sharedHome = fs.mkdtempSync(path.join(os.tmpdir(), "t3code-codex-shared-"));
    const shadowHome = path.join(os.tmpdir(), `t3code-codex-shadow-${randomUUID()}`);
    try {
      const layout = resolveCodexHomeLayout(
        decodeCodexSettings({
          homePath: sharedHome,
          shadowHomePath: shadowHome,
        }),
      );

      expect(layout).toMatchObject({
        mode: "authOverlay",
        sharedHomePath: sharedHome,
        effectiveHomePath: shadowHome,
        continuationKey: `codex:home:${sharedHome}`,
      });
    } finally {
      fs.rmSync(sharedHome, { recursive: true, force: true });
      fs.rmSync(shadowHome, { recursive: true, force: true });
    }
  });

  it("materializes a shadow home with shared state links and private auth", async () => {
    const sharedHome = fs.mkdtempSync(path.join(os.tmpdir(), "t3code-codex-shared-"));
    const shadowHome = path.join(os.tmpdir(), `t3code-codex-shadow-${randomUUID()}`);
    try {
      fs.mkdirSync(path.join(sharedHome, "sessions"));
      fs.writeFileSync(path.join(sharedHome, "config.toml"), 'model = "gpt-5-codex"\n');
      fs.writeFileSync(path.join(sharedHome, "models_cache.json"), '{"models":["shared"]}\n');
      fs.writeFileSync(path.join(sharedHome, "auth.json"), '{"shared":true}\n');
      fs.mkdirSync(shadowHome, { recursive: true });
      fs.writeFileSync(path.join(shadowHome, "auth.json"), '{"shadow":true}\n');
      fs.symlinkSync(
        path.join(sharedHome, "models_cache.json"),
        path.join(shadowHome, "models_cache.json"),
      );

      const layout = resolveCodexHomeLayout(
        decodeCodexSettings({
          homePath: sharedHome,
          shadowHomePath: shadowHome,
        }),
      );

      await Effect.runPromise(materializeCodexShadowHome(layout));

      expect(fs.lstatSync(path.join(shadowHome, "sessions")).isSymbolicLink()).toBe(true);
      expect(fs.lstatSync(path.join(shadowHome, "config.toml")).isSymbolicLink()).toBe(true);
      expect(fs.existsSync(path.join(shadowHome, "models_cache.json"))).toBe(false);
      expect(fs.lstatSync(path.join(shadowHome, "auth.json")).isSymbolicLink()).toBe(false);
      expect(fs.readFileSync(path.join(shadowHome, "auth.json"), "utf8")).toContain("shadow");
    } finally {
      fs.rmSync(sharedHome, { recursive: true, force: true });
      fs.rmSync(shadowHome, { recursive: true, force: true });
    }
  });

  it("rejects shadow homes that point at the shared home", async () => {
    const sharedHome = fs.mkdtempSync(path.join(os.tmpdir(), "t3code-codex-shared-"));
    try {
      const layout = resolveCodexHomeLayout(
        decodeCodexSettings({
          homePath: sharedHome,
          shadowHomePath: sharedHome,
        }),
      );

      await expect(Effect.runPromise(materializeCodexShadowHome(layout))).rejects.toBeInstanceOf(
        CodexShadowHomeError,
      );
    } finally {
      fs.rmSync(sharedHome, { recursive: true, force: true });
    }
  });
});
