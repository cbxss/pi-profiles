import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

  assert.equal(existsSync(join(agentDir, "profiles-repo", ".git")), true);
  const config = readJson(join(agentDir, "profiles-repo", "profiles.json"));
  assert.deepEqual(Object.keys(config.profiles), ["coding"]);
});

test("/profiles use defaults to session scope", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-profiles-"));
  const agentDir = join(root, "agent");
  const profileRepo = join(agentDir, "profiles-repo");
  mkdirSync(profileRepo, { recursive: true });

  writeFileSync(join(profileRepo, "profiles.json"), JSON.stringify({
    profiles: {
      security: { tools: ["read"], appendSystemPrompt: "Track hypotheses." },
    },
  }, null, 2));

  runPi(agentDir, root, "/profiles use security");

  assert.equal(existsSync(join(root, ".pi", "profiles-state.json")), false);
  assert.equal(existsSync(join(root, ".pi", "settings.json")), false);
});

test("/profiles use --project and clear --project update repo state and managed extensions", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-profiles-"));
  const agentDir = join(root, "agent");
  const profileRepo = join(agentDir, "profiles-repo");
  mkdirSync(profileRepo, { recursive: true });
  mkdirSync(join(profileRepo, "profile-extensions", "security-tools"), { recursive: true });

  writeFileSync(join(profileRepo, "profiles.json"), JSON.stringify({
    profiles: {
      security: {
        extensions: ["./profile-extensions/security-tools"],
        tools: ["read", "bash", "edit", "write"],
        thinkingLevel: "high",
        appendSystemPrompt: "Track hypotheses.",
      },
    },
  }, null, 2));

  runPi(agentDir, root, "/profiles use security --project");

  const expectedExtension = join(profileRepo, "profile-extensions", "security-tools");
  assert.deepEqual(readJson(join(root, ".pi", "profiles-state.json")).active, "security");
  assert.deepEqual(readJson(join(root, ".pi", "settings.json")).extensions, [expectedExtension]);

  runPi(agentDir, root, "/profiles clear --project");

  assert.equal(readJson(join(root, ".pi", "profiles-state.json")).active, null);
  assert.deepEqual(readJson(join(root, ".pi", "settings.json")).extensions, []);
});
