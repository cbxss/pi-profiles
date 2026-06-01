# pi-profiles

VS Code-style profiles for [pi](https://pi.dev): switch sets of skills, prompt templates, extension paths, tools, model/thinking settings, and per-profile instructions.

## Install for local development

This repo is meant to live outside `~/.pi/agent/extensions`, then be symlinked into Pi's auto-discovery directory:

```bash
ln -s "$PWD/extensions/profiles" ~/.pi/agent/extensions/profiles
```

Reload pi with `/reload` after changing the extension.

## Commands

```text
/profiles              open profile selector
/profiles list         list configured profiles
/profiles current      show active profile
/profiles use <name>   activate a profile and reload resources
/profiles <name>       shorthand for use
/profiles clear        clear active profile and reload resources
/profiles init         create ~/.pi/agent/profiles.json starter config
```

## Config

Profiles are read from:

- `~/.pi/agent/profiles.json`
- `<cwd>/.pi/profiles.json` (overrides global profiles with the same name)

Example:

```json
{
  "default": "coding",
  "profiles": {
    "coding": {
      "description": "Default coding setup",
      "skills": [],
      "prompts": [],
      "extensions": [],
      "tools": ["read", "bash", "edit", "write"],
      "thinkingLevel": "high",
      "instructions": "You are in coding mode. Make focused, correct changes and validate them."
    },
    "security": {
      "description": "Security research setup",
      "skills": ["~/.agents/skills/apex-re", "~/.agents/skills/hypothesis"],
      "prompts": ["~/.pi/agent/profile-resources/security/prompts"],
      "extensions": ["~/.pi/agent/profile-extensions/security-tools"],
      "tools": ["read", "bash", "edit", "write"],
      "thinkingLevel": "high",
      "instructions": "You are in security research mode. Track hypotheses and document attempts."
    }
  }
}
```

Relative paths are resolved from the `profiles.json` file that defines the profile. `~`, `{cwd}`, and `${cwd}` are supported.

## Notes

- Skills, prompts, and themes are contributed through Pi's `resources_discover` event.
- Profile-managed extensions are written into `~/.pi/agent/settings.json` under `extensions`, then Pi is reloaded. Keep those extension files outside `~/.pi/agent/extensions/` unless you want them always enabled.
- Active state is stored in `~/.pi/agent/profiles-state.json`.
