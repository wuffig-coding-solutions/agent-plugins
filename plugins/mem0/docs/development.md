# Development Notes

## Context

Built for a developer who:

- Frequently starts new projects and wants zero CLAUDE.md re-deployment overhead
- Uses self-hosted mem0: Qdrant (vector) + Neo4j (graph) via Docker Compose
- Wants fully implicit memory — no manual `/save` or `/remember` commands
- Uses Claude Code as primary coding environment with Claude as LLM provider
- Organizes memory in two scopes: `user_id` (global) and `agent_id` (per-project)

---

## Architecture Decisions

### Plugin format over standalone `.claude/`

Chosen so the plugin can be installed across projects via
`/plugin install mem0@agent-plugins` without manual file copying.
Hooks in plugins are fully supported at the plugin level
(the restriction only applies to hooks _inside agent files_).

### mem0 native extraction — no custom graph code

Earlier versions (v1–v4) added manual Neo4j queries and category prefixes
in vector content. This was overengineering. mem0 handles extraction via
internal LLM call on `client.add()` and Mem0ᵍ handles graph extraction
automatically when Neo4j is configured.

### Custom extraction prompt in `stop.py`

mem0's default extraction is general-purpose. The custom prompt improves
signal/noise by specifying what to capture (architecture facts, decisions,
preferences, non-obvious fixes) and what to skip.

### `agent_id` auto-detected from directory name

Reduces friction for frequent project creation. Override via `MEM0_AGENT_ID`.

### PostCompact hook

Critical for long sessions. Without it, mem0-injected context is lost after
every `/compact` because compaction summarizes but drops injected blocks.

### SubagentStart uses task description as search query

Provides semantically relevant context per subagent task instead of generic dump.
Mechanical tasks (format, lint, test) are skipped.

---

## Open Questions

1. **Extraction quality** — not yet validated against real sessions.
   Run `/mem0:audit` after 10+ sessions and iterate on extraction prompt.

2. **Duplicate handling** — mem0 has conflict resolution but not tested in practice.

3. **Threshold calibration** — defaults (0.35/0.25) are educated guesses.
   See `docs/future-work.md` for auto-calibration ideas.

4. **Mem0ᵍ graph memory** — optional and not tested with self-hosted stack.
   Test: configure `NEO4J_URI` and verify entity nodes appear in Neo4j browser.

5. **mem0 cloud reliability** — the cloud MCP endpoint had repeated outages
   during development. Consider running mem0 locally via Docker.

---

## File Structure

```
claude-mem0-plugin/
├── .claude-plugin/
│   └── plugin.json          ← Plugin manifest (name, version, author)
├── hooks/
│   ├── hooks.json           ← Hook registrations (uses ${CLAUDE_PLUGIN_ROOT})
│   ├── _env.py              ← Shared: env loading + mem0 client factory
│   ├── sessionstart.py      ← Load context at session start
│   ├── userpromptsubmit.py  ← Search mem0 before every prompt
│   ├── stop.py              ← Extract + save after every response
│   ├── postcompact.py       ← Re-inject after /compact
│   ├── subagentstart.py     ← Inject context into subagents
│   └── subagentstop.py      ← Save subagent findings
├── skills/
│   └── memory-audit/
│       └── SKILL.md         ← /mem0:audit skill
├── scripts/
│   └── docker-compose.yml   ← Qdrant + Neo4j
└── docs/
    ├── setup.md
    ├── architecture.md
    ├── development.md       ← This file
    └── future-work.md       ← Cron, GitHub Actions, auto-improvement
```

---

## Resume Prompt

To continue work in a new session:

```
I'm working on claude-mem0-plugin — a Claude Code plugin for implicit
persistent memory via mem0. Read docs/development.md for full context.
Current focus: [your next task]
```
