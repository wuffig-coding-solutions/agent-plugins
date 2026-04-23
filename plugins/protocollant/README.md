# protocollant — Claude Code Plugin

Automatically maintains a structured knowledge base in `docs/` and keeps `CLAUDE.md` in sync. Claude knows about the docs from the first turn of every session — no on-demand skill trigger needed.

## How it works

| Mechanism                   | What it does                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------ |
| **SessionStart hook**       | Injects a routing table into Claude's context: which doc to read for which task type |
| **PostToolUse hook**        | Detects architecture/API/bug/dep-relevant file edits and queues a doc update         |
| **Stop hook**               | If the queue is non-empty, tells Claude to call `@doc-updater` before finishing      |
| **`@doc-updater` subagent** | Writes structured entries to the relevant docs, then patches `CLAUDE.md`             |
| **`/docs-init` command**    | One-time scaffold of all doc files from a codebase scan                              |
| **`/docs-sync` command**    | Manual full audit — use after major refactors                                        |

## Managed docs

All files live in `docs/`:

| File                   | Purpose                                    |
| ---------------------- | ------------------------------------------ |
| `architecture.md`      | Module map, layers, constraints            |
| `known-issues.md`      | Open bugs with symptoms and workarounds    |
| `resolved-bugs.md`     | Fixed bugs with root cause and fix         |
| `future-work.md`       | TODOs, feature ideas, roadmap              |
| `decisions.md`         | ADR-style technical decisions              |
| `api-contracts.md`     | Endpoint and interface definitions         |
| `data-models.md`       | DB schema, entities, migrations            |
| `dependencies.md`      | Key packages and why they were chosen      |
| `performance-notes.md` | Bottlenecks, optimizations, benchmarks     |
| `security-notes.md`    | Sensitive areas, mitigations, threat model |
| `testing-strategy.md`  | Test patterns, coverage goals              |
| `deployment.md`        | Environments, CI/CD, rollback              |
| `integrations.md`      | Third-party APIs, MCP servers, webhooks    |
| `onboarding.md`        | Setup steps, gotchas for fresh agents      |
| `changelog.md`         | Notable changes by date                    |

## Setup

### 1. Install the plugin

This plugin is distributed via [agent-plugins](https://github.com/wuffig-coding-solutions/agent-plugins). In any Claude Code session:

```
/plugin install protocollant@agent-plugins
```

This fetches the plugin from GitHub, registers the hooks, and makes `@doc-updater`, `/docs-init`, and `/docs-sync` available globally.

### 3. Initialize docs for a project

Open a session in the project you want to document, then run:

```
/docs-init
```

This scans the codebase and creates all 15 doc files under `docs/`. After that, documentation updates happen automatically — no further setup needed.

## Scope

- **Repo-scope**: `docs/` and the hooks live in the project. All docs are committed to git and readable by any Claude instance that clones the repo.
- **No user-scope** needed: the routing knowledge is generated fresh each SessionStart from the actual files on disk.

## Design decisions

**Why not a skill?** Skills are on-demand — Claude has to decide to invoke them. The SessionStart hook injects the routing table unconditionally, so Claude always knows which docs exist and when to read them, without any invocation step.

**Why a subagent instead of inline?** The doc-updater runs in an isolated context with clear instructions and no session history to distract it. It's faster and more consistent than asking the main Claude instance to "also update the docs" mid-task.

**Why `docs/` instead of `.claude/docs/`?** These docs are project knowledge, not agent configuration. They should be committed, diffed, and reviewed like any other project documentation.
