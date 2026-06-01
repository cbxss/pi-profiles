import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const repo = resolve(import.meta.dirname, "..");
const extension = join(repo, "extensions", "profiles", "index.ts");

function runPi(agentDir, cwd, prompt) {
  const result = spawnSync("pi", ["--no-extensions", "-e", extension, "-p", prompt], {
    cwd,
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

test("/profiles init creates starter config", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-profiles-"));
  const agentDir = join(root, "agent");

  runPi(agentDir, root, "/profiles init");

  const config = readJson(join(agentDir, "profiles.json"));
  assert.deepEqual(Object.keys(config.profiles), ["coding"]);
});

test("/profiles use and clear update state and managed extensions", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-profiles-"));
  const agentDir = join(root, "agent");
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(join(agentDir, "profile-extensions", "security-tools"), { recursive: true });

  writeFileSync(join(agentDir, "profiles.json"), JSON.stringify({
    profiles: {
      security: {
        extensions: ["./profile-extensions/security-tools"],
        tools: ["read", "bash", "edit", "write"],
        thinkingLevel: "high",
        instructions: "Track hypotheses.",
      },
    },
  }, null, 2));

  runPi(agentDir, root, "/profiles use security");

  const expectedExtension = join(agentDir, "profile-extensions", "security-tools");
  assert.deepEqual(readJson(join(agentDir, "profiles-state.json")).active, "security");
  assert.deepEqual(readJson(join(agentDir, "settings.json")).extensions, [expectedExtension]);

  runPi(agentDir, root, "/profiles clear");

  assert.equal(readJson(join(agentDir, "profiles-state.json")).active, undefined);
  assert.deepEqual(readJson(join(agentDir, "settings.json")).extensions, []);
});
