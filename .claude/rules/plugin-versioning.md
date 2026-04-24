# Plugin Versioning Rule

Whenever you make any changes to a plugin — code, hooks, skills, agents, README, or manifest — you **must** bump the version before pushing to GitHub.

## What counts as a change

Any modification under `plugins/<name>/`, including:

- Hook scripts (`hooks/*.js`, `hooks/*.py`)
- Skills (`skills/*/SKILL.md`)
- Agents (`agents/*.md`)
- Manifests (`.claude-plugin/plugin.json`)
- Documentation (`README.md`, `docs/`)

## How to bump

Update the version in **both** files — they must stay in sync:

1. `plugins/<name>/.claude-plugin/plugin.json` — `"version"` field
2. `.claude-plugin/marketplace.json` — `"version"` for that plugin's entry

Use semantic versioning:

- **Patch** (`x.x.1`) — bug fixes, typo/doc corrections, minor tweaks
- **Minor** (`x.1.0`) — new features, new skills, new hooks
- **Major** (`2.0.0`) — breaking changes to hook API, removed tools, incompatible restructuring

## Why this matters

The plugin cache is keyed by version number. If code changes but the version doesn't, `/reload-plugins` silently reuses the old cached copy — your changes never reach Claude Code.
