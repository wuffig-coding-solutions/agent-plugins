# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A personal Claude Code plugin registry. All plugins live under `plugins/` and are indexed by `.claude-plugin/marketplace.json`. Each plugin is an independent unit with its own hooks, skills, agents, and manifest.

## Release workflow

Whenever you change a plugin's code, you **must** bump the version in both of these files — they must match:

- `plugins/<name>/.claude-plugin/plugin.json` → `"version"` field
- `.claude-plugin/marketplace.json` → `"version"` for that plugin entry

Then:

```bash
rm -rf ~/.claude/plugins/cache/agent-plugins/<plugin-name>/<old-version>
```

Run `/reload-plugins` in Claude Code. For MCP server changes, restart Claude Code entirely.

## Adding a new plugin

1. Create `plugins/<plugin-name>/`
2. Add `.claude-plugin/plugin.json` with at minimum `name` and `version`
3. Add an entry in `.claude-plugin/marketplace.json` using `source: "git-subdir"`, pointing `path` to `plugins/<plugin-name>` and `ref` to `"main"`
4. Commit, push, `/reload-plugins`

## Plugin structure

Each plugin can have any combination of:

| Path                         | Purpose                                  |
| ---------------------------- | ---------------------------------------- |
| `.claude-plugin/plugin.json` | Manifest (name, version, mcpServers)     |
| `hooks/hooks.json`           | Hook registrations (lifecycle → command) |
| `hooks/*.js` / `hooks/*.py`  | Hook implementations                     |
| `skills/<name>/SKILL.md`     | Invocable skills                         |
| `agents/<name>.md`           | Subagent definitions                     |

## Hooks

Hooks receive JSON on stdin and write JSON to stdout. The important fields:

- **Input**: `cwd`, `tool_input` (PostToolUse), `messages` (Stop/SubagentStop)
- **Output**: `additionalContext` (string injected into Claude's context), `blockReason` (string to block the action)
- `${CLAUDE_PLUGIN_ROOT}` resolves to the plugin install path at runtime

Hooks that only side-effect (e.g. write a file) should `process.exit(0)` with no stdout.

## Plugins at a glance

### protocollant (JS hooks)

Maintains 15 structured docs in `docs/` and keeps `CLAUDE.md` in sync.

- **SessionStart** — reads `docs/`, injects routing table into Claude's context, prints tracer notice to stderr, clears `.claude/.protocoll-queue.local`
- **PostToolUse** (Edit/Write/MultiEdit) — detects which knowledge domain changed, appends to `.claude/.protocoll-queue.local`
- **Stop** — if queue non-empty, tells Claude to delegate to `@doc-updater` and print a summary
- `@doc-updater` subagent (`agents/doc-updater.md`) does the actual doc writes and patches `CLAUDE.md`
- `/docs-init` skill scaffolds all 15 docs from a codebase scan and adds `.claude/.protocoll-queue.local` to `.gitignore`

### mem0 (Python hooks)

Persistent memory via mem0.ai. Dual-scope: `user_id` (global) + `user_id + agent_id` (per-project). `agent_id` auto-detects as `os.path.basename(cwd)`.

- **SessionStart** — fetches all memories, injects into system prompt
- **UserPromptSubmit** — semantic search on the prompt, prefixes `[Memory: …]`
- **Stop** — saves last N messages; `EXTRACTION_PROMPT` in `stop.py` controls what gets stored
- **PostCompact** — re-injects project context after `/compact` clears injected blocks
- **SubagentStart/Stop** — task-relevant injection; stricter extraction (facts only)
- MCP gateway at Railway (`https://mem0-gateway-production.up.railway.app/mcp`) exposed via `.mcp.json`

Key env vars: `MEM0_API_KEY`, `MEM0_USER_ID`, `MEM0_AGENT_ID` (optional), `MEM0_TOP_K` (default 5), `MEM0_USER_THRESHOLD` (0.35), `MEM0_AGENT_THRESHOLD` (0.25).

### website-commenter (TypeScript MCP server)

Browser extension bridge. Comments posted from Firefox → HTTP server → MCP channel notification → Claude interrupts immediately.

- Bridge server (`bridge/server.ts`) runs as stdio MCP, also opens HTTP on port 8780–8799
- MCP tools: `get_bridge_port`, `get_website_comments`, `clear_website_comments`, `connect_bridge`, `disconnect_bridge`
- Channel interrupts require `claude --dangerously-load-development-channels`
- Skills: `/wc-connect` (get port), `/wc-apply` (manual apply), `/wc-disconnect`, `/wc-statusline`
- State stored in `/tmp/claude-wc-bridge-<PID>.json` (per-process, supports multiple Claude windows)

Tests:

```bash
cd plugins/website-commenter && bun test
```

Use `WC_NO_MCP=1` and `WC_NO_STATE_FILE=1` env vars to skip side-effects in tests.
