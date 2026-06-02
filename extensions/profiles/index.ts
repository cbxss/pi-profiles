import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
type Scope = "session" | "project";

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
  appendSystemPrompt?: string;
};

type LoadedProfile = Profile & { name: string; source: string };
type Config = { profiles?: Record<string, Profile> };
type State = { active?: string | null; extensions?: string[]; scope?: Scope; updatedAt?: string };

const AGENT_DIR = getAgentDir();
const PROFILE_REPO = join(AGENT_DIR, "profiles-repo");
const REPO_CONFIG = join(PROFILE_REPO, "profiles.json");
const COMMANDS = ["list", "current", "use", "clear", "init", "sync"];

function projectConfig(cwd: string) {
  return join(cwd, ".pi", "profiles.json");
}

function projectStateFile(cwd: string) {
  return join(cwd, ".pi", "profiles-state.json");
}

function projectSettingsFile(cwd: string) {
  return join(cwd, ".pi", "settings.json");
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

  for (const file of [REPO_CONFIG, projectConfig(cwd)]) {
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

function projectState(cwd: string): State {
  return json<State>(projectStateFile(cwd), {});
}

function saveProjectState(cwd: string, next: State) {
  saveJson(projectStateFile(cwd), { ...next, scope: "project", updatedAt: new Date().toISOString() });
}

function setProjectExtensions(cwd: string, next: string[] = []) {
  const previous = new Set(projectState(cwd).extensions ?? []);
  if (previous.size === 0 && next.length === 0) return [];

  const settingsPath = projectSettingsFile(cwd);
  const settings = json<Record<string, unknown>>(settingsPath, {});
  const current = Array.isArray(settings.extensions)
    ? settings.extensions.filter((item): item is string => typeof item === "string")
    : [];

  settings.extensions = Array.from(new Set([...current.filter((item) => !previous.has(item)), ...next]));
  saveJson(settingsPath, settings);
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

function starterConfig(): Config {
  return {
    profiles: {
      coding: {
        description: "Default coding setup",
        tools: ["read", "bash", "edit", "write"],
        thinkingLevel: "high",
        appendSystemPrompt: "Make focused changes and validate them.",
      },
    },
  };
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
  let activeScope: Scope | undefined;

  function sessionState(ctx: ExtensionContext): State {
    const branch = ctx.sessionManager.getBranch() as Array<{ type?: string; customType?: string; data?: State }>;
    for (const entry of [...branch].reverse()) {
      if (entry.type === "custom" && entry.customType === "profiles-state") return entry.data ?? {};
    }
    return {};
  }

  function effectiveState(ctx: ExtensionContext): State {
    const session = sessionState(ctx);
    if ("active" in session) return { ...session, scope: "session" };

    const project = projectState(ctx.cwd);
    if ("active" in project) return { ...project, scope: "project" };

    return {};
  }

  function refresh(ctx: ExtensionContext) {
    const state = effectiveState(ctx);
    activeScope = state.scope;
    active = typeof state.active === "string" ? loadProfiles(ctx.cwd)[state.active] : undefined;
    return active;
  }

  function setStatus(ctx: ExtensionContext) {
    const label = active ? `profile:${active.name}${activeScope === "project" ? ":project" : ""}` : undefined;
    ctx.ui.setStatus("profiles", label ? ctx.ui.theme.fg("accent", label) : undefined);
  }

  async function activate(name: string, ctx: ExtensionContext, scope: Scope) {
    const profile = loadProfiles(ctx.cwd)[name];
    if (!profile) return ctx.ui.notify(`Unknown profile "${name}"`, "error");

    if (scope === "project") {
      const extensions = setProjectExtensions(ctx.cwd, profile.extensions);
      saveProjectState(ctx.cwd, { active: name, extensions });
    } else {
      if (profile.extensions?.length) ctx.ui.notify("Profile extensions require --project scope; skipped for this session.", "warning");
      pi.appendEntry("profiles-state", { active: name, scope: "session" });
    }

    active = profile;
    activeScope = scope;
    await applyRuntime(profile, pi, ctx);
    setStatus(ctx);
    ctx.ui.notify(`Profile "${name}" activated for ${scope}. Reloading…`, "info");
    await ctx.reload();
  }

  async function clear(ctx: ExtensionContext, scope?: Scope) {
    const target = scope ?? effectiveState(ctx).scope ?? "session";
    if (target === "project") {
      setProjectExtensions(ctx.cwd, []);
      saveProjectState(ctx.cwd, { active: null, extensions: [] });
    } else {
      pi.appendEntry("profiles-state", { active: null, scope: "session" });
    }

    active = undefined;
    activeScope = undefined;
    setStatus(ctx);
    ctx.ui.notify(`Profile cleared for ${target}. Reloading…`, "info");
    await ctx.reload();
  }

  function show(content: string) {
    pi.sendMessage({ customType: "profiles", content, display: true });
  }

  function hasProfileRepo() {
    return existsSync(join(PROFILE_REPO, ".git"));
  }

  async function git(args: string[], timeout = 30000) {
    return pi.exec("git", ["-C", PROFILE_REPO, ...args], { timeout });
  }

  async function repoHasRemote() {
    if (!hasProfileRepo()) return false;
    const result = await git(["remote"], 5000);
    return result.code === 0 && result.stdout.trim().length > 0;
  }

  async function pullProfiles(ctx: ExtensionContext, notify = false) {
    if (!(await repoHasRemote())) return;
    const result = await git(["pull", "--ff-only"], 30000);
    if (notify) ctx.ui.notify(result.code === 0 ? "Profiles pulled" : `Profile pull failed: ${result.stderr || result.stdout}`, result.code === 0 ? "info" : "warning");
  }

  async function pushProfiles(ctx: ExtensionContext) {
    if (!hasProfileRepo()) return ctx.ui.notify("No profile repo. Run /profiles init first.", "warning");

    await git(["add", "-A"]);
    const status = await git(["status", "--porcelain"]);
    if (status.stdout.trim()) {
      const commit = await git(["commit", "-m", "Update profiles"]);
      if (commit.code !== 0) return ctx.ui.notify(`Profile commit failed: ${commit.stderr || commit.stdout}`, "warning");
    }

    const remotes = await git(["remote"], 5000);
    const remote = remotes.stdout.trim().split(/\s+/)[0];
    if (!remote) return ctx.ui.notify("Profile changes committed locally. Add a git remote to push.", "info");
    const pushed = await git(["push", "-u", remote, "HEAD"]);
    ctx.ui.notify(pushed.code === 0 ? "Profiles pushed" : `Profile push failed: ${pushed.stderr || pushed.stdout}`, pushed.code === 0 ? "info" : "warning");
  }

  async function initProfileRepo(ctx: ExtensionContext, remote?: string) {
    if (remote && !existsSync(PROFILE_REPO)) {
      const cloned = await pi.exec("git", ["clone", remote, PROFILE_REPO], { timeout: 60000 });
      if (cloned.code !== 0) return ctx.ui.notify(`Profile clone failed: ${cloned.stderr || cloned.stdout}`, "warning");
    }

    mkdirSync(PROFILE_REPO, { recursive: true });
    if (!hasProfileRepo()) await pi.exec("git", ["-C", PROFILE_REPO, "init"], { timeout: 30000 });
    if (remote && !(await repoHasRemote())) await git(["remote", "add", "origin", remote]);
    if (!existsSync(REPO_CONFIG)) saveJson(REPO_CONFIG, starterConfig());

    ctx.ui.notify(`Profile repo ready: ${PROFILE_REPO}. Reloading…`, "info");
    await ctx.reload();
  }

  pi.on("resources_discover", (_event, ctx) => {
    const profile = refresh(ctx);
    if (!profile) return;
    return {
      skillPaths: profile.skills ?? [],
      promptPaths: profile.prompts ?? [],
      themePaths: profile.themes ?? [],
    };
  });

  pi.on("session_start", async (_event, ctx) => {
    await pullProfiles(ctx);
    refresh(ctx);
    if (active) await applyRuntime(active, pi, ctx);
    setStatus(ctx);
  });

  pi.on("before_agent_start", (event) => {
    if (!active?.appendSystemPrompt) return;
    return { systemPrompt: `${event.systemPrompt}\n\n# Active pi profile: ${active.name}\n\n${active.appendSystemPrompt}` };
  });

  pi.registerCommand("profiles", {
    description: "Switch pi profiles: skills, extensions, prompts, tools, model, thinking, appended system prompt",
    getArgumentCompletions(prefix) {
      const names = Object.keys(loadProfiles(process.cwd()));
      const matches = [...COMMANDS, ...names].filter((item) => item.startsWith(prefix));
      return matches.length ? matches.map((value) => ({ value, label: value })) : null;
    },
    async handler(args, ctx) {
      const rawParts = (args ?? "").trim().split(/\s+/).filter(Boolean);
      const scope: Scope = rawParts.includes("--project") ? "project" : "session";
      const [command, name] = rawParts.filter((part) => part !== "--project");
      const profiles = loadProfiles(ctx.cwd);
      const current = effectiveState(ctx);
      const activeName = typeof current.active === "string" ? current.active : undefined;

      if (!command) {
        const names = Object.keys(profiles).sort();
        if (!names.length) return ctx.ui.notify("No profiles found. Run /profiles init", "warning");
        const choice = await ctx.ui.select("Select profile", ["(clear)", ...names.map((n) => n === activeName ? `${n} (active)` : n)]);
        if (!choice) return;
        return choice === "(clear)" ? clear(ctx) : activate(choice.replace(/ \(active\)$/, ""), ctx, "session");
      }

      if (command === "init") return initProfileRepo(ctx, name);

      if (command === "sync") {
        if (name === "pull") {
          await pullProfiles(ctx, true);
          return ctx.reload();
        }
        if (name === "push") return pushProfiles(ctx);
        if (!hasProfileRepo()) return ctx.ui.notify("No profile repo. Run /profiles init first.", "warning");
        const status = await git(["status", "-sb"]);
        return show(status.stdout.trim() || "Profile repo clean");
      }

      if (command === "list") {
        const names = Object.keys(profiles).sort();
        if (!names.length) return ctx.ui.notify("No profiles found. Run /profiles init", "warning");
        return show(names.map((n) => `${n === activeName ? "*" : " "} ${n} — ${summary(profiles[n])}`).join("\n"));
      }

      if (command === "current") {
        const profile = activeName ? profiles[activeName] : undefined;
        const scopeLabel = current.scope ? ` (${current.scope})` : "";
        return show(profile ? `Active profile${scopeLabel}: ${profile.name}\n${summary(profile)}\nSource: ${profile.source}` : "No active profile.");
      }

      if (command === "clear") return clear(ctx, scope);
      if (command === "use") return name ? activate(name, ctx, scope) : ctx.ui.notify("Usage: /profiles use <name> [--project]", "info");
      return activate(command, ctx, scope);
    },
  });
}
