# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A Claude Code plugin (`mem0`, v0.5.0) that provides fully implicit persistent memory across sessions and projects via [mem0](https://mem0.ai/). Memory is captured automatically — no manual commands — using 7 lifecycle hooks.

## Setup

```bash
# Install Python dependency
pip install mem0ai

# Required env vars (place in ~/.claude/.env or project .env)
MEM0_API_KEY=<key>
MEM0_USER_ID=<username>         # global scope identifier
MEM0_AGENT_ID=<project-name>    # optional; auto-detected from cwd basename

# Self-hosted backend (optional)
cd scripts && docker compose up -d   # starts Qdrant (6333) + Neo4j (7687/7474)
```

Test a hook manually by piping mock JSON input:

```bash
echo '{"messages":[]}' | python3 hooks/sessionstart.py
```

## Architecture

### Dual-Scope Memory Model

All memory operations use two scopes simultaneously:

- **`user_id`** — global, cross-project preferences and facts
- **`user_id` + `agent_id`** — per-project architecture facts, decisions, paths

`agent_id` auto-detects from `os.path.basename(os.getcwd())` in `_env.py` if `MEM0_AGENT_ID` is not set.

### Hook Lifecycle

```
SessionStart    → get_all(user_id) + get_all(agent_id) → inject into system prompt
UserPromptSubmit → search(prompt, dual scope)            → prefix [Memory: …] to prompt
Stop            → add(last N messages, dual scope)       → mem0 extracts + dedupes facts
PostCompact     → get_all(agent_id)                     → re-inject after /compact loss
SubagentStart   → search(task desc, dual scope)         → inject task-relevant context
SubagentStop    → add(subagent conv, agent_id only)     → stricter extraction (facts only)
Notification    → macOS/Linux desktop notification
```

### Module Responsibilities

| File                           | Role                                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------- |
| `hooks/_env.py`                | Shared: `.env` loader, `agent_id()` auto-detection, `MemoryClient` factory                         |
| `hooks/stop.py`                | Core extraction: passes last `MEM0_MAX_MESSAGES` messages to mem0 with `EXTRACTION_PROMPT`         |
| `hooks/subagentstart.py`       | Skips injection for mechanical tasks (format, lint, test); uses task description as semantic query |
| `hooks/subagentstop.py`        | Stricter extraction — facts/paths/decisions only, no exploratory reasoning                         |
| `hooks/postcompact.py`         | Critical: re-injects project context after `/compact` which otherwise loses injected blocks        |
| `skills/memory-audit/SKILL.md` | Defines the `/mem0:audit` skill (evaluate memory quality, flag duplicates/staleness)               |

### Extraction Prompt (in `stop.py`)

Controls what gets stored. Captures: architecture facts, stack decisions, user preferences, non-obvious fixes. Excludes: hypotheticals, general knowledge, temporary task instructions. Modify `EXTRACTION_PROMPT` in `stop.py` to tune signal quality.

## Key Configuration

| Variable                       | Default | Effect                                          |
| ------------------------------ | ------- | ----------------------------------------------- |
| `MEM0_TOP_K`                   | `5`     | Max memories returned per search                |
| `MEM0_USER_THRESHOLD`          | `0.35`  | Min relevance score for user-scope injection    |
| `MEM0_AGENT_THRESHOLD`         | `0.25`  | Min relevance score for project-scope injection |
| `MEM0_MAX_MESSAGES`            | `20`    | Messages passed to mem0 in Stop hook            |
| `NEO4J_URI` / `NEO4J_PASSWORD` | —       | Enables Mem0ᵍ graph memory (optional)           |

## Plugin Distribution

The plugin is installed via Claude Code's plugin system, not npm/pip directly. `hooks/hooks.json` registers all hooks using `${CLAUDE_PLUGIN_ROOT}` to resolve paths at runtime. `plugin.json` is the manifest.

The MCP server (`.mcp.json`) exposes mem0 tools via a Railway SSE gateway — separate from the hooks pipeline.
