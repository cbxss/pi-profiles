import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

type Profile = {
  description?: string;
  skills?: string[];
  prompts?: string[];
  themes?: string[];
  extensions?: string[];
  tools?: string[];
  provider?: string;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  instructions?: string;
};

type LoadedProfile = Profile & {
  name: string;
  sourceFile: string;
  baseDir: string;
};

type ProfilesFile = {
  default?: string;
  profiles?: Record<string, Profile>;
  [name: string]: unknown;
};

type ProfileState = {
  activeProfile?: string;
  managedExtensions?: string[];
  updatedAt?: string;
};

type LoadedProfiles = {
  profiles: Record<string, LoadedProfile>;
  defaultProfile?: string;
  files: string[];
};

function agentDir(): string {
  return getAgentDir();
}

function statePath(): string {
  return join(agentDir(), "profiles-state.json");
}

function globalProfilesPath(): string {
  return join(agentDir(), "profiles.json");
}

function projectProfilesPath(cwd: string): string {
  return join(cwd, ".pi", "profiles.json");
}

function settingsPath(): string {
  return join(agentDir(), "settings.json");
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (error) {
    console.error(`[profiles] failed to read ${path}:`, error);
    return fallback;
  }
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

function expandUser(path: string): string {
  if (path === "~") return process.env.HOME ?? path;
  if (path.startsWith("~/")) return join(process.env.HOME ?? "", path.slice(2));
  return path;
}

function resolveResourcePath(rawPath: string, baseDir: string, cwd: string): string {
  let path = rawPath.replaceAll("${cwd}", cwd).replaceAll("{cwd}", cwd);
  path = expandUser(path);
  if (isAbsolute(path)) return path;
  return resolve(baseDir, path);
}

function normalizeProfile(name: string, profile: Profile, sourceFile: string, cwd: string): LoadedProfile {
  const baseDir = dirname(sourceFile);
  const resolveList = (items?: string[]) =>
    items?.map((item) => resolveResourcePath(item, baseDir, cwd)).filter(Boolean);

  return {
    ...profile,
    name,
    sourceFile,
    baseDir,
    skills: resolveList(profile.skills),
    prompts: resolveList(profile.prompts),
    themes: resolveList(profile.themes),
    extensions: resolveList(profile.extensions),
  };
}

function profilesFromFile(path: string, cwd: string): { profiles: Record<string, LoadedProfile>; defaultProfile?: string } {
  const raw = readJson<ProfilesFile | undefined>(path, undefined);
  if (!raw) return { profiles: {} };

  const rawProfiles = raw.profiles && typeof raw.profiles === "object"
    ? raw.profiles
    : Object.fromEntries(
        Object.entries(raw).filter(([key, value]) =>
          !["default", "version", "$schema"].includes(key) &&
          value &&
          typeof value === "object" &&
          !Array.isArray(value),
        ),
      ) as Record<string, Profile>;

  const profiles: Record<string, LoadedProfile> = {};
  for (const [name, profile] of Object.entries(rawProfiles)) {
    profiles[name] = normalizeProfile(name, profile, path, cwd);
  }

  return { profiles, defaultProfile: raw.default };
}

function loadProfiles(cwd: string): LoadedProfiles {
  const files = [globalProfilesPath(), projectProfilesPath(cwd)].filter(existsSync);
  const merged: Record<string, LoadedProfile> = {};
  let defaultProfile: string | undefined;

  for (const file of files) {
    const loaded = profilesFromFile(file, cwd);
    Object.assign(merged, loaded.profiles);
    if (loaded.defaultProfile) defaultProfile = loaded.defaultProfile;
  }

  return { profiles: merged, defaultProfile, files };
}

function readState(): ProfileState {
  return readJson<ProfileState>(statePath(), {});
}

function writeState(state: ProfileState): void {
  writeJson(statePath(), { ...state, updatedAt: new Date().toISOString() });
}

function profileSummary(profile: LoadedProfile): string {
  const parts: string[] = [];
  if (profile.description) parts.push(profile.description);
  if (profile.skills?.length) parts.push(`${profile.skills.length} skill path(s)`);
  if (profile.prompts?.length) parts.push(`${profile.prompts.length} prompt path(s)`);
  if (profile.themes?.length) parts.push(`${profile.themes.length} theme path(s)`);
  if (profile.extensions?.length) parts.push(`${profile.extensions.length} extension path(s)`);
  if (profile.tools?.length) parts.push(`tools:${profile.tools.join(",")}`);
  if (profile.provider && profile.model) parts.push(`${profile.provider}/${profile.model}`);
  if (profile.thinkingLevel) parts.push(`thinking:${profile.thinkingLevel}`);
  return parts.join(" | ") || "No description";
}

function updateManagedExtensions(nextExtensions: string[]): string[] {
  const state = readState();
  const previous = new Set(state.managedExtensions ?? []);
  const next = Array.from(new Set(nextExtensions));
  const settings = readJson<Record<string, unknown>>(settingsPath(), {});
  const current = Array.isArray(settings.extensions) ? settings.extensions.filter((item): item is string => typeof item === "string") : [];

  const filtered = current.filter((entry) => !previous.has(entry));
  const merged = Array.from(new Set([...filtered, ...next]));
  settings.extensions = merged;
  writeJson(settingsPath(), settings);
  return next;
}

function removeManagedExtensions(): void {
  const state = readState();
  const previous = new Set(state.managedExtensions ?? []);
  if (previous.size === 0) return;

  const settings = readJson<Record<string, unknown>>(settingsPath(), {});
  const current = Array.isArray(settings.extensions) ? settings.extensions.filter((item): item is string => typeof item === "string") : [];
  settings.extensions = current.filter((entry) => !previous.has(entry));
  writeJson(settingsPath(), settings);
}

async function applyRuntime(profile: LoadedProfile, pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  if (profile.provider && profile.model) {
    const model = ctx.modelRegistry.find(profile.provider, profile.model);
    if (!model) {
      ctx.ui.notify(`Profile "${profile.name}": model ${profile.provider}/${profile.model} not found`, "warning");
    } else {
      const ok = await pi.setModel(model);
      if (!ok) ctx.ui.notify(`Profile "${profile.name}": no API key for ${profile.provider}/${profile.model}`, "warning");
    }
  }

  if (profile.thinkingLevel) {
    pi.setThinkingLevel(profile.thinkingLevel);
  }

  if (profile.tools?.length) {
    const known = new Set(pi.getAllTools().map((tool) => tool.name));
    const valid = profile.tools.filter((tool) => known.has(tool));
    const invalid = profile.tools.filter((tool) => !known.has(tool));
    if (invalid.length) ctx.ui.notify(`Profile "${profile.name}": unknown tools: ${invalid.join(", ")}`, "warning");
    if (valid.length) pi.setActiveTools(valid);
  }
}

function updateStatus(ctx: ExtensionContext, activeName?: string): void {
  ctx.ui.setStatus("profiles", activeName ? ctx.ui.theme.fg("accent", `profile:${activeName}`) : undefined);
}

function usage(ctx: ExtensionContext): void {
  ctx.ui.notify("Usage: /profiles [list|current|use <name>|clear|init]", "info");
}

export default function profilesExtension(pi: ExtensionAPI) {
  let activeProfile: LoadedProfile | undefined;

  function refreshActive(cwd: string): LoadedProfile | undefined {
    const { profiles } = loadProfiles(cwd);
    const state = readState();
    activeProfile = state.activeProfile ? profiles[state.activeProfile] : undefined;
    return activeProfile;
  }

  pi.on("resources_discover", async (event) => {
    const profile = refreshActive(event.cwd);
    if (!profile) return;
    return {
      skillPaths: profile.skills ?? [],
      promptPaths: profile.prompts ?? [],
      themePaths: profile.themes ?? [],
    };
  });

  pi.on("session_start", async (_event, ctx) => {
    const profile = refreshActive(ctx.cwd);
    if (profile) {
      await applyRuntime(profile, pi, ctx);
      updateStatus(ctx, profile.name);
    } else {
      updateStatus(ctx, undefined);
    }
  });

  pi.on("before_agent_start", async (event) => {
    if (!activeProfile?.instructions) return;
    return {
      systemPrompt: `${event.systemPrompt}\n\n# Active pi profile: ${activeProfile.name}\n\n${activeProfile.instructions}`,
    };
  });

  pi.registerCommand("profiles", {
    description: "Switch VS Code-style pi profiles (skills, extensions, prompts, tools, model, thinking, instructions)",
    getArgumentCompletions: (prefix: string) => {
      const { profiles } = loadProfiles(process.cwd());
      const commands = ["list", "current", "use", "clear", "init"];
      const profileNames = Object.keys(profiles);
      const values = [...commands, ...profileNames].filter((value) => value.startsWith(prefix));
      return values.length ? values.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      const loaded = loadProfiles(ctx.cwd);
      const state = readState();
      const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
      const command = parts[0];

      if (!command) {
        const names = Object.keys(loaded.profiles).sort();
        if (names.length === 0) {
          ctx.ui.notify(`No profiles found. Run /profiles init or create ${globalProfilesPath()}`, "warning");
          return;
        }
        const choice = await ctx.ui.select(
          "Select profile",
          ["(clear)", ...names.map((name) => `${name}${name === state.activeProfile ? " (active)" : ""}`)],
        );
        if (!choice) return;
        if (choice === "(clear)") parts.splice(0, parts.length, "clear");
        else parts.splice(0, parts.length, "use", choice.replace(/ \(active\)$/, ""));
      }

      const action = parts[0];

      if (action === "init") {
        const target = globalProfilesPath();
        if (existsSync(target)) {
          ctx.ui.notify(`${target} already exists`, "warning");
          return;
        }
        writeJson(target, {
          default: "coding",
          profiles: {
            coding: {
              description: "Default coding setup",
              skills: [],
              prompts: [],
              extensions: [],
              tools: ["read", "bash", "edit", "write"],
              thinkingLevel: "high",
              instructions: "You are in coding mode. Make focused, correct changes and validate them.",
            },
          },
        });
        ctx.ui.notify(`Created ${target}`, "info");
        await ctx.reload();
        return;
      }

      if (action === "list") {
        const names = Object.keys(loaded.profiles).sort();
        if (names.length === 0) {
          ctx.ui.notify(`No profiles found. Config files checked: ${[globalProfilesPath(), projectProfilesPath(ctx.cwd)].join(", ")}`, "warning");
          return;
        }
        const text = names.map((name) => `${name === state.activeProfile ? "*" : " "} ${name} — ${profileSummary(loaded.profiles[name])}`).join("\n");
        pi.sendMessage({ customType: "profiles", content: text, display: true });
        return;
      }

      if (action === "current") {
        const current = state.activeProfile ? loaded.profiles[state.activeProfile] : undefined;
        const text = current
          ? `Active profile: ${current.name}\n${profileSummary(current)}\nSource: ${current.sourceFile}`
          : "No active profile.";
        pi.sendMessage({ customType: "profiles", content: text, display: true });
        return;
      }

      if (action === "clear") {
        removeManagedExtensions();
        writeState({ activeProfile: undefined, managedExtensions: [] });
        activeProfile = undefined;
        ctx.ui.notify("Profile cleared. Reloading resources…", "info");
        await ctx.reload();
        return;
      }

      const requestedName = action === "use" ? parts[1] : action;
      if (!requestedName) {
        usage(ctx);
        return;
      }

      const profile = loaded.profiles[requestedName];
      if (!profile) {
        const available = Object.keys(loaded.profiles).sort().join(", ") || "(none)";
        ctx.ui.notify(`Unknown profile "${requestedName}". Available: ${available}`, "error");
        return;
      }

      const managedExtensions = updateManagedExtensions(profile.extensions ?? []);
      writeState({ activeProfile: profile.name, managedExtensions });
      activeProfile = profile;
      await applyRuntime(profile, pi, ctx);
      updateStatus(ctx, profile.name);
      ctx.ui.notify(`Profile "${profile.name}" activated. Reloading resources…`, "info");
      await ctx.reload();
      return;
    },
  });
}
