# website-commenter

A Claude Code plugin that lets you click on any DOM element in Firefox, leave a comment, and have Claude **immediately interrupt** whatever it's doing and apply the change — no manual command needed.

## How it works

```
Firefox extension  →  POST /comments  →  Bridge (HTTP + MCP stdio)  →  channel notification  →  Claude Code
```

- Claude Code auto-spawns `bridge/server.ts` as an MCP server (stdio transport) on session start
- The bridge also runs an HTTP server on a free port in the `8780–8799` range
- When the extension POSTs a comment, the bridge fires a `notifications/claude/channel` notification
- Claude interrupts its current work and applies the change

## Skills

| Command       | Purpose                                                                      |
| ------------- | ---------------------------------------------------------------------------- |
| `/wc-connect` | Get this session's port → connect the browser extension                      |
| `/wc-apply`   | Manually fetch and apply pending comments (fallback if channel isn't firing) |

Use `/wc-connect` first. It calls the `get_bridge_port` MCP tool, which is session-scoped and always returns the correct port even if multiple Claude Code windows are open.

## Architecture

```
plugins/website-commenter/
├── .claude-plugin/
│   └── plugin.json          # MCP server registration + version
├── bridge/
│   ├── server.ts            # HTTP + MCP server in one process
│   ├── find-port.ts         # Finds a free port in 8780–8799
│   └── server.test.ts       # Integration tests (WC_NO_MCP=1, WC_NO_STATE_FILE=1)
├── hooks/
│   └── session-start.js     # Runs at session start (no-op; bridge starts via MCP)
└── skills/
    ├── wc-connect/SKILL.md  # Connect the browser extension
    └── wc-apply/SKILL.md    # Fallback: manually apply pending comments
```

### MCP tools exposed by the bridge

| Tool                     | Description                                                 |
| ------------------------ | ----------------------------------------------------------- |
| `get_bridge_port`        | Returns the HTTP port this session's bridge is listening on |
| `get_website_comments`   | Returns all pending comments (fallback polling)             |
| `clear_website_comments` | Clears pending comments by ID or all                        |

### Environment flags

| Flag                 | Effect                                                    |
| -------------------- | --------------------------------------------------------- |
| `WC_NO_MCP=1`        | Skip MCP transport init (used in tests)                   |
| `WC_NO_STATE_FILE=1` | Skip writing `/tmp/claude-wc-bridge.json` (used in tests) |

## Browser extension

The extension lives in a separate repo. Two changes are needed for the default port:

- `background.js`: `DEFAULT_BRIDGE_PORT = 8780`
- `popup.html`: port input `value="8780"`
- `popup.js`: `DEFAULT_BRIDGE_PORT = 8780`

The popup shows **"Connected · ⚡ Channel active"** when the MCP handshake is complete, or **"Connected · Polling mode"** if the channel is unavailable (use `/wc-apply` in that case).

## Development workflow

> **Important:** The plugin cache is keyed by version number. If you don't bump the version, `/reload-plugins` will silently skip the re-fetch.

### Making changes

1. Edit files under `plugins/website-commenter/`
2. Run tests: `cd plugins/website-commenter && bun test`
3. Bump the version in **both** places:
   - `plugins/website-commenter/.claude-plugin/plugin.json` → `"version"`
   - `.claude-plugin/marketplace.json` → `"version"` for the `website-commenter` entry
4. Commit and push

### Reloading the plugin in Claude Code

```bash
# First time after a version bump (clears the old cached version):
rm -rf ~/.claude/plugins/cache/agent-plugins/website-commenter/<old-version>
```

Then run `/reload-plugins` in Claude Code.

### Versioning convention

Use [semver](https://semver.org/):

- **Patch** (`1.0.x`) — bug fixes, no behaviour change
- **Minor** (`1.x.0`) — new features, new tools, new skills
- **Major** (`x.0.0`) — breaking changes to the bridge API or plugin contract

## Running tests

```bash
cd plugins/website-commenter
bun test
```

Tests spawn the bridge with `WC_NO_MCP=1 WC_NO_STATE_FILE=1` to skip stdio transport and state file writes.
