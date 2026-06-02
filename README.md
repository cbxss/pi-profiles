# pi-profiles

Profiles for pi. Switch skills, prompts, extensions, tools, model settings, and appended system prompt with `/profiles`.

## Install

```bash
pi install https://github.com/cbxss/pi-profiles
```

<details>
<summary>Manual install</summary>

```bash
git clone https://github.com/cbxss/pi-profiles ~/code/pi-profiles
ln -s ~/code/pi-profiles/extensions/profiles ~/.pi/agent/extensions/profiles
```

Then run `/reload` in pi.

</details>

## Commands

```text
/profiles              pick a profile
/profiles list         list profiles
/profiles current      show active profile
/profiles use NAME     switch profile
/profiles NAME         switch profile
/profiles clear        disable profiles
/profiles init [URL]   create or clone ~/.pi/agent/profiles-repo
/profiles sync         git status for profiles-repo
/profiles sync pull    git pull --ff-only
/profiles sync push    commit changes and push
```

## Config

Profiles live in:

- `~/.pi/agent/profiles-repo/profiles.json`
- `~/.pi/agent/profiles.json` legacy fallback
- `.pi/profiles.json` project override

`profiles-repo` is a normal git repo. pi pulls it on startup when a remote is configured. Put shared prompts, skills, and profile-only extensions next to `profiles.json`.

```json
{
  "profiles": {
    "coding": {
      "tools": ["read", "bash", "edit", "write"],
      "thinkingLevel": "high",
      "appendSystemPrompt": "Make focused changes and validate them."
    },
    "security": {
      "skills": ["./skills/apex-re", "./skills/hypothesis"],
      "prompts": ["./prompts/security"],
      "extensions": ["./extensions/security-tools"],
      "tools": ["read", "bash", "edit", "write"],
      "thinkingLevel": "high",
      "appendSystemPrompt": "Track hypotheses and document attempts."
    }
  }
}
```

Paths are resolved relative to the config file. `~`, `{cwd}`, and `${cwd}` work.

Profile extensions should live outside `~/.pi/agent/extensions`; otherwise pi loads them all the time.
