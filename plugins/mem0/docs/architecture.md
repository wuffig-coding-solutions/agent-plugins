# Architecture

## Data Flow

```
┌──────────────────────────────────────────────────────────┐
│                    Claude Code Session                    │
│                                                          │
│  Session begins                                          │
│       │                                                  │
│       └── SessionStart hook                              │
│               get_all(user_id)   ─→ mem0 ─→ Qdrant      │
│               get_all(agent_id)  ─→ mem0 ─→ Qdrant      │
│               ← inject [Session context: ...]            │
│                                                          │
│  User types prompt                                       │
│       │                                                  │
│       └── UserPromptSubmit hook                          │
│               search(prompt, user_id)   ─→ mem0          │
│               search(prompt, agent_id)  ─→ mem0          │
│               ← inject [Memory: ...] prefix if relevant  │
│                                                          │
│       ▼                                                  │
│  Claude processes prompt + injected context              │
│       │                                                  │
│       └── Stop hook                                      │
│               add(conversation, user_id)   ─→ mem0       │
│               add(conversation, agent_id)  ─→ mem0       │
│               (mem0 extracts facts internally via LLM)   │
│                                                          │
│  If /compact occurs:                                     │
│       └── PostCompact hook                               │
│               get_all(agent_id) ─→ re-inject context     │
│                                                          │
│  If subagent spawned:                                    │
│       ├── SubagentStart → inject task-relevant context   │
│       └── SubagentStop  → save findings to agent_id     │
└──────────────────────────────────────────────────────────┘
```

## Memory Scopes

```
mem0
├── user_id: "niklas"
│   ├── "Prefers Prettier, TypeScript strict mode"
│   ├── "Communicates in German"
│   └── "Uses Qdrant + Docker Compose for vector storage"
│
└── user_id: "niklas" + agent_id: "project-x"
    ├── "Auth uses NextAuth + JWT, TTL 24h"
    ├── "DB: PostgreSQL + Prisma, schema at /prisma/schema.prisma"
    └── "Qdrant collection must exist before first client.add()"
```

## Plugin Structure

```
claude-mem0-plugin/
├── .claude-plugin/
│   └── plugin.json       ← manifest: name "mem0", version, author
│
├── hooks/
│   ├── hooks.json        ← event registrations, uses ${CLAUDE_PLUGIN_ROOT}
│   ├── _env.py           ← shared: load .env, return MemoryClient
│   ├── sessionstart.py   ← fires once at session start
│   ├── userpromptsubmit.py ← fires before every prompt
│   ├── stop.py           ← fires after every Claude response
│   ├── postcompact.py    ← fires after /compact
│   ├── subagentstart.py  ← fires when subagent is spawned
│   └── subagentstop.py   ← fires when subagent finishes
│
├── skills/
│   └── memory-audit/
│       └── SKILL.md      ← /mem0:audit — review + improve memory quality
│
├── scripts/
│   └── docker-compose.yml ← Qdrant (6333) + Neo4j (7687/7474)
│
└── docs/
    ├── setup.md
    ├── architecture.md   ← this file
    ├── development.md    ← design decisions, open questions
    └── future-work.md    ← automated auditing, cron, GitHub Actions
```

## mem0 Internal Architecture

mem0 uses a two-phase approach internally on every `client.add()` call:

**Extraction phase:** An internal LLM call processes the conversation
and extracts salient facts based on the extraction instructions in metadata.

**Update phase:** Extracted facts are compared against existing memories.
Duplicates are merged, contradictions resolved, new facts stored.

When Neo4j is configured (Mem0ᵍ mode), mem0 additionally:
- Extracts entity nodes (people, technologies, services)
- Extracts relationship edges between entities
- Enables graph traversal for multi-hop queries

```
Qdrant (vector store)          Neo4j (graph store, optional)
  semantic similarity    +       entity relationships
         │                              │
         └──────────── mem0 ────────────┘
                          │
                   ranked + fused results
```

## Hook Lifecycle

```
Session
  │
  └─ SessionStart ──────────────────────── load user + project context
      │
      └─ [Per turn]
          │
          ├─ UserPromptSubmit ─────────── search + inject memories
          │
          │   [Claude responds]
          │
          ├─ Stop ─────────────────────── extract + save to mem0
          │
          └─ (if /compact)
              └─ PostCompact ──────────── re-inject project context

  [If subagent spawned]
      ├─ SubagentStart ──────────────────── inject task context
      │   [Subagent works]
      └─ SubagentStop ───────────────────── save findings
```
