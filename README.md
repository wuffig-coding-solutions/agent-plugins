# agent-plugins — Claude Code Plugin Registry

Personal plugin registry for the `wuffig-coding-solutions` org. All plugins live in `plugins/` and are indexed by `.claude-plugin/marketplace.json`.

## Install

```
/plugin marketplace add wuffig-coding-solutions/agent-plugins
/plugin install protocollant@agent-plugins
/plugin install mem0@agent-plugins
/plugin install website-commenter@agent-plugins
```

## Plugins

| Plugin              | Description                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------- |
| `protocollant`      | Maintains a structured knowledge base in `docs/` and keeps `CLAUDE.md` in sync              |
| `mem0`              | Persistent memory via mem0 — fully implicit, no manual commands                             |
| `website-commenter` | Browser extension bridge for commenting on DOM elements — interrupts Claude via MCP channel |

## Publishing updates

### Version bumps are mandatory

The plugin cache is keyed by **version number**. If you change code but don't bump the version, `/reload-plugins` will silently skip re-fetching — your changes never reach Claude Code.

When updating any plugin, bump the version in **both** files:

| File                                        | What to change                      |
| ------------------------------------------- | ----------------------------------- |
| `plugins/<name>/.claude-plugin/plugin.json` | `"version"` field                   |
| `.claude-plugin/marketplace.json`           | `"version"` for that plugin's entry |

These must match. If you forget either one, the update won't roll out.

### Full workflow

1. Edit files under `plugins/<name>/`
2. Run tests if applicable
3. Bump the version in **both** files listed above
4. Commit and push
5. Clear the old cache and reload:

```bash
rm -rf ~/.claude/plugins/cache/agent-plugins/<plugin-name>/<old-version>
```

Then run `/reload-plugins` in Claude Code.

## Adding a new plugin

1. Create a directory under `plugins/<plugin-name>/`
2. Add `.claude-plugin/plugin.json` with at minimum `name` and `version`
3. Add an entry to `.claude-plugin/marketplace.json`:

```json
{
  "name": "<plugin-name>",
  "description": "...",
  "version": "1.0.0",
  "author": { "name": "Niklas-Flaig" },
  "source": {
    "source": "git-subdir",
    "url": "https://github.com/wuffig-coding-solutions/agent-plugins.git",
    "path": "plugins/<plugin-name>",
    "ref": "main"
  }
}
```

4. Commit, push, and run `/reload-plugins`.
