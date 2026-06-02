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
/profiles use NAME     switch profile for this session
/profiles NAME         switch profile for this session
/profiles use NAME --project
                      switch profile for this repo
/profiles clear        disable profile for this session
/profiles clear --project
                      disable profile for this repo
/profiles init [URL]   create or clone ~/.pi/agent/profiles-repo
/profiles sync         git status for profiles-repo
/profiles sync pull    git pull --ff-only
/profiles sync push    commit changes and push
```

## Config

Profiles live in:

- `~/.pi/agent/profiles-repo/profiles.json`
- `.pi/profiles.json` project override

`profiles-repo` is a normal git repo. pi pulls it on startup when a remote is configured.

Keep shared resources inside the repo and use relative paths. Absolute paths and `~` are machine-local and won't sync cleanly.

```text
profiles-repo/
  profiles.json
  skills/
  prompts/
  extensions/
```

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

By default, profiles are session-scoped, so other pi terminals stay unchanged. Use `--project` to make the profile stick for the current repo.

Profile extensions only apply with `--project`, because pi loads extensions from settings during reload. Keep them in `profiles-repo/extensions`, not `~/.pi/agent/extensions`; otherwise pi loads them all the time.
