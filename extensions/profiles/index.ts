import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

type LoadedProfile = Profile & { name: string; source: string };
type Config = { profiles?: Record<string, Profile> };
type State = { active?: string; extensions?: string[]; updatedAt?: string };

const AGENT_DIR = getAgentDir();
const GLOBAL_CONFIG = join(AGENT_DIR, "profiles.json");
const STATE_FILE = join(AGENT_DIR, "profiles-state.json");
const SETTINGS_FILE = join(AGENT_DIR, "settings.json");
const COMMANDS = ["list", "current", "use", "clear", "init"];

function projectConfig(cwd: string) {
  return join(cwd, ".pi", "profiles.json");
}

function json<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (error) {
    console.error(`[profiles] failed to read ${path}:`, error);
    return fallback;
  }
}

function saveJson(path: string, data: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function resolvePath(path: string, fromFile: string, cwd: string) {
  path = path.replaceAll("${cwd}", cwd).replaceAll("{cwd}", cwd);
  if (path === "~") path = process.env.HOME ?? path;
  if (path.startsWith("~/")) path = join(process.env.HOME ?? "", path.slice(2));
  return isAbsolute(path) ? path : resolve(dirname(fromFile), path);
}

function loadProfiles(cwd: string) {
  const profiles: Record<string, LoadedProfile> = {};

  for (const file of [GLOBAL_CONFIG, projectConfig(cwd)]) {
    const config = json<Config>(file, {});
    for (const [name, profile] of Object.entries(config.profiles ?? {})) {
      const paths = (items?: string[]) => items?.map((item) => resolvePath(item, file, cwd));
      profiles[name] = {
        ...profile,
        name,
        source: file,
        skills: paths(profile.skills),
        prompts: paths(profile.prompts),
        themes: paths(profile.themes),
        extensions: paths(profile.extensions),
      };
    }
  }

  return profiles;
}

function state(): State {
  return json<State>(STATE_FILE, {});
}

function saveState(next: State) {
  saveJson(STATE_FILE, { ...next, updatedAt: new Date().toISOString() });
}

function setProfileExtensions(next: string[] = []) {
  const previous = new Set(state().extensions ?? []);
  if (previous.size === 0 && next.length === 0) return [];

  const settings = json<Record<string, unknown>>(SETTINGS_FILE, {});
  const current = Array.isArray(settings.extensions)
    ? settings.extensions.filter((item): item is string => typeof item === "string")
    : [];

  settings.extensions = Array.from(new Set([...current.filter((item) => !previous.has(item)), ...next]));
  saveJson(SETTINGS_FILE, settings);
  return next;
}

function summary(profile: LoadedProfile) {
  return [
    profile.description,
    profile.skills?.length && `${profile.skills.length} skill path(s)`,
    profile.prompts?.length && `${profile.prompts.length} prompt path(s)`,
    profile.themes?.length && `${profile.themes.length} theme path(s)`,
    profile.extensions?.length && `${profile.extensions.length} extension path(s)`,
    profile.tools?.length && `tools:${profile.tools.join(",")}`,
    profile.provider && profile.model && `${profile.provider}/${profile.model}`,
    profile.thinkingLevel && `thinking:${profile.thinkingLevel}`,
  ].filter(Boolean).join(" | ") || "No description";
}

async function applyRuntime(profile: LoadedProfile, pi: ExtensionAPI, ctx: ExtensionContext) {
  if (profile.provider && profile.model) {
    const model = ctx.modelRegistry.find(profile.provider, profile.model);
    if (!model) ctx.ui.notify(`Profile "${profile.name}": model not found`, "warning");
    else if (!(await pi.setModel(model))) ctx.ui.notify(`Profile "${profile.name}": no API key for model`, "warning");
  }

  if (profile.thinkingLevel) pi.setThinkingLevel(profile.thinkingLevel);

  if (profile.tools?.length) {
    const known = new Set(pi.getAllTools().map((tool) => tool.name));
    const valid = profile.tools.filter((tool) => known.has(tool));
    const invalid = profile.tools.filter((tool) => !known.has(tool));
    if (invalid.length) ctx.ui.notify(`Profile "${profile.name}": unknown tools: ${invalid.join(", ")}`, "warning");
    if (valid.length) pi.setActiveTools(valid);
  }
}

export default function profilesExtension(pi: ExtensionAPI) {
  let active: LoadedProfile | undefined;

  function refresh(cwd: string) {
    const activeName = state().active;
    active = activeName ? loadProfiles(cwd)[activeName] : undefined;
    return active;
  }

  function setStatus(ctx: ExtensionContext) {
    ctx.ui.setStatus("profiles", active ? ctx.ui.theme.fg("accent", `profile:${active.name}`) : undefined);
  }

  async function activate(name: string, ctx: ExtensionContext) {
    const profile = loadProfiles(ctx.cwd)[name];
    if (!profile) {
      ctx.ui.notify(`Unknown profile "${name}"`, "error");
      return;
    }

    const extensions = setProfileExtensions(profile.extensions);
    saveState({ active: name, extensions });
    active = profile;
    await applyRuntime(profile, pi, ctx);
    setStatus(ctx);
    ctx.ui.notify(`Profile "${name}" activated. Reloading…`, "info");
    await ctx.reload();
  }

  async function clear(ctx: ExtensionContext) {
    setProfileExtensions([]);
    saveState({ active: undefined, extensions: [] });
    active = undefined;
    setStatus(ctx);
    ctx.ui.notify("Profile cleared. Reloading…", "info");
    await ctx.reload();
  }

  function show(content: string) {
    pi.sendMessage({ customType: "profiles", content, display: true });
  }

  pi.on("resources_discover", (event) => {
    const profile = refresh(event.cwd);
    if (!profile) return;
    return {
      skillPaths: profile.skills ?? [],
      promptPaths: profile.prompts ?? [],
      themePaths: profile.themes ?? [],
    };
  });

  pi.on("session_start", async (_event, ctx) => {
    refresh(ctx.cwd);
    if (active) await applyRuntime(active, pi, ctx);
    setStatus(ctx);
  });

  pi.on("before_agent_start", (event) => {
    if (!active?.instructions) return;
    return { systemPrompt: `${event.systemPrompt}\n\n# Active pi profile: ${active.name}\n\n${active.instructions}` };
  });

  pi.registerCommand("profiles", {
    description: "Switch pi profiles: skills, extensions, prompts, tools, model, thinking, instructions",
    getArgumentCompletions(prefix) {
      const names = Object.keys(loadProfiles(process.cwd()));
      const matches = [...COMMANDS, ...names].filter((item) => item.startsWith(prefix));
      return matches.length ? matches.map((value) => ({ value, label: value })) : null;
    },
    async handler(args, ctx) {
      const [command, name] = (args ?? "").trim().split(/\s+/).filter(Boolean);
      const profiles = loadProfiles(ctx.cwd);
      const activeName = state().active;

      if (!command) {
        const names = Object.keys(profiles).sort();
        if (!names.length) return ctx.ui.notify(`No profiles found. Run /profiles init`, "warning");
        const choice = await ctx.ui.select("Select profile", ["(clear)", ...names.map((n) => n === activeName ? `${n} (active)` : n)]);
        if (!choice) return;
        return choice === "(clear)" ? clear(ctx) : activate(choice.replace(/ \(active\)$/, ""), ctx);
      }

      if (command === "init") {
        if (existsSync(GLOBAL_CONFIG)) return ctx.ui.notify(`${GLOBAL_CONFIG} already exists`, "warning");
        saveJson(GLOBAL_CONFIG, {
          profiles: {
            coding: {
              description: "Default coding setup",
              tools: ["read", "bash", "edit", "write"],
              thinkingLevel: "high",
              instructions: "You are in coding mode. Make focused, correct changes and validate them.",
            },
          },
        });
        ctx.ui.notify(`Created ${GLOBAL_CONFIG}. Reloading…`, "info");
        return ctx.reload();
      }

      if (command === "list") {
        const names = Object.keys(profiles).sort();
        if (!names.length) return ctx.ui.notify(`No profiles found. Run /profiles init`, "warning");
        return show(names.map((n) => `${n === activeName ? "*" : " "} ${n} — ${summary(profiles[n])}`).join("\n"));
      }

      if (command === "current") {
        const current = activeName ? profiles[activeName] : undefined;
        return show(current ? `Active profile: ${current.name}\n${summary(current)}\nSource: ${current.source}` : "No active profile.");
      }

      if (command === "clear") return clear(ctx);
      if (command === "use") return name ? activate(name, ctx) : ctx.ui.notify("Usage: /profiles use <name>", "info");
      return activate(command, ctx);
    },
  });
}
