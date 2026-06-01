# pi-profiles

Profiles for pi. Switch skills, prompts, extensions, tools, model settings, and appended system prompt with `/profiles`.

## Install

```bash
git clone <repo> ~/code/pi-profiles
ln -s ~/code/pi-profiles/extensions/profiles ~/.pi/agent/extensions/profiles
```

Then run `/reload` in pi.

## Commands

```text
/profiles            pick a profile
/profiles list       list profiles
/profiles current    show active profile
/profiles use NAME   switch profile
/profiles NAME       switch profile
/profiles clear      disable profiles
/profiles init       create ~/.pi/agent/profiles.json
```

## Config

Profiles live in:

- `~/.pi/agent/profiles.json`
- `.pi/profiles.json`

Project profiles override global profiles with the same name.

```json
{
  "profiles": {
    "coding": {
      "tools": ["read", "bash", "edit", "write"],
      "thinkingLevel": "high",
      "appendSystemPrompt": "Make focused changes and validate them."
    },
    "security": {
      "skills": ["~/.agents/skills/apex-re", "~/.agents/skills/hypothesis"],
      "prompts": ["~/.pi/agent/profile-resources/security/prompts"],
      "extensions": ["~/.pi/agent/profile-extensions/security-tools"],
      "tools": ["read", "bash", "edit", "write"],
      "thinkingLevel": "high",
      "appendSystemPrompt": "Track hypotheses and document attempts."
    }
  }
}
```

Paths are resolved relative to the config file. `~`, `{cwd}`, and `${cwd}` work.

Profile extensions should live outside `~/.pi/agent/extensions`; otherwise pi loads them all the time.
