# agent-plugins — Claude Code Plugin Registry

Central marketplace registry for the `wuffig-coding-solutions` org. Plugin repos dispatch their latest SHA here on every push to `main`; this repo stores the pinned SHAs in `.claude-plugin/marketplace.json`.

## Install a plugin

```
/plugin marketplace add wuffig-coding-solutions/agent-plugins
/plugin install protocollant@agent-plugins
/plugin install mem0@agent-plugins
```

---

## Org-level secrets & variables

Both are set once on the `wuffig-coding-solutions` org (visibility: **All repositories**) and inherited automatically by every plugin repo — no per-repo configuration needed.

| Type     | Name                   | Value                                   |
| -------- | ---------------------- | --------------------------------------- |
| Variable | `PLUGIN_REGISTRY_REPO` | `wuffig-coding-solutions/agent-plugins` |
| Secret   | `PLUGIN_REGISTRY_PAT`  | Fine-grained PAT (see below)            |

### `PLUGIN_REGISTRY_PAT` — required permissions

Create a **fine-grained PAT** at `github.com/settings/personal-access-tokens/new`:

| Setting             | Value                     |
| ------------------- | ------------------------- |
| Resource owner      | `wuffig-coding-solutions` |
| Repository access   | Only `agent-plugins`      |
| Contents permission | **Read and write**        |

Store the generated token value as the org secret `PLUGIN_REGISTRY_PAT` at:  
`github.com/organizations/wuffig-coding-solutions/settings/secrets/actions`

---

## How the pipeline works

```
Plugin repo push to main
  └── notify-registry.yml
        └── gh api POST /repos/PLUGIN_REGISTRY_REPO/dispatches
              └── agent-plugins: sync-shas.yml (repository_dispatch)
                    └── Updates sha in .claude-plugin/marketplace.json
                          └── Commits + pushes
```

---

## Adding a new plugin repo

1. Scaffold the plugin with `/create-plugin` — the `notify-registry.yml` workflow is included automatically.
2. Add an entry to `.claude-plugin/marketplace.json` (leave `sha` empty — CI fills it on first push):

```json
{
  "name": "<plugin-name>",
  "description": "...",
  "version": "1.0.0",
  "author": { "name": "Niklas-Flaig" },
  "source": {
    "source": "git-subdir",
    "url": "https://github.com/wuffig-coding-solutions/<plugin-name>.git",
    "path": ".",
    "ref": "main",
    "sha": ""
  }
}
```

3. Push to `main` — the SHA is populated automatically.
