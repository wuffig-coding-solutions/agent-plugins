# claude-mem0-plugin

Persistent memory for Claude Code via mem0. Fully implicit — no manual commands.

Stores personal preferences, project architecture facts, and known issues
across projects using Qdrant (vector) and optional Neo4j (graph).

## Install

```bash
# Add marketplace (one-time)
/plugin marketplace add wuffig-coding-solutions/agent-plugins

# Install plugin
/plugin install mem0@agent-plugins

# Set credentials (hooks)
export MEM0_API_KEY=your-key
export MEM0_USER_ID=your-username
```

Restart Claude Code. Done.

## What it does

| Hook               | When             | Action                                |
| ------------------ | ---------------- | ------------------------------------- |
| `SessionStart`     | Session begins   | Load user prefs + project context     |
| `UserPromptSubmit` | Every prompt     | Search mem0, inject relevant memories |
| `Stop`             | Every response   | Extract + save new facts              |
| `PostCompact`      | After `/compact` | Re-inject project context             |
| `SubagentStart`    | Subagent spawned | Inject task-relevant context          |
| `SubagentStop`     | Subagent done    | Save subagent findings                |
| `Notification`     | Claude waiting   | Desktop notification                  |

## Scopes

```
user_id: "your-username"     → global preferences, cross-project patterns
agent_id: "project-name"     → project stack, architecture, debug insights
```

`agent_id` is auto-detected from the current directory name. Override:

```bash
export MEM0_AGENT_ID=my-project
```

## Self-hosted stack

```bash
cd scripts && docker compose up -d
```

Starts Qdrant on `localhost:6333` and Neo4j on `localhost:7687`.
With Neo4j configured, mem0 automatically uses graph memory (Mem0ᵍ).

## Configuration

| Variable               | Default         | Description                     |
| ---------------------- | --------------- | ------------------------------- |
| `MEM0_API_KEY`         | required        | From app.mem0.ai or self-hosted |
| `MEM0_USER_ID`         | `user`          | Your user identifier            |
| `MEM0_AGENT_ID`        | auto (dir name) | Project identifier              |
| `MEM0_TOP_K`           | `5`             | Max memories per search         |
| `MEM0_USER_THRESHOLD`  | `0.35`          | Min score, user scope           |
| `MEM0_AGENT_THRESHOLD` | `0.25`          | Min score, project scope        |
| `MEM0_MAX_MESSAGES`    | `20`            | Max messages saved per session  |
| `NEO4J_URI`            | —               | Enable graph memory             |
| `NEO4J_USER`           | `neo4j`         | Neo4j username                  |
| `NEO4J_PASSWORD`       | —               | Neo4j password                  |

## MCP server

The plugin connects to the mem0 gateway via Streamable HTTP with OAuth2.
Claude Code handles authentication automatically on first connect — no
tokens to manage. Claude can proactively call `search_memory`,
`add_memories`, and `list_memories` in addition to the automatic hooks.

## Memory audit

Run `/mem0:audit` to review memory quality and get improvement suggestions
for the extraction prompt.

## Docs

- [Setup guide](docs/setup.md)
- [Architecture](docs/architecture.md)
- [Development notes](docs/development.md)
- [Future work](docs/future-work.md)
