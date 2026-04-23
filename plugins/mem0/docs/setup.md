# Setup Guide

## Option A: Plugin install (recommended)

```bash
/plugin marketplace add wuffig-coding-solutions/agent-plugins
/plugin install mem0@agent-plugins
```

Then set environment variables (add to `~/.zshrc` or `~/.bashrc`):

```bash
export MEM0_API_KEY=your-key       # mem0 SDK (for hooks)
export MEM0_USER_ID=your-username  # your mem0 user identifier
```

## Option B: Manual install

```bash
git clone https://github.com/Niklas-Flaig/mem0-plugin
cd claude-mem0-plugin
pip3 install mem0ai
cp hooks/*.py ~/.claude/hooks/
# merge hooks/hooks.json into ~/.claude/settings.json
```

## MCP server authentication

The MCP server uses OAuth2 (Streamable HTTP transport). Claude Code handles
the auth flow automatically on first connect — no tokens or credentials to
manage manually.

Restart Claude Code and run `/mcp` to confirm `mem0` is listed as connected.
If prompted, complete the auth flow in the browser.

## Self-hosted Qdrant + Neo4j stack

```bash
cd scripts
docker compose up -d
```

Starts:

- Qdrant: `localhost:6333`
- Neo4j: `localhost:7687` (bolt), `localhost:7474` (browser UI)

## Verify

Start Claude Code and check `/hooks` — all 7 hooks should be listed.
Check `/mcp` — `mem0` should appear as connected.
After a few sessions you'll see `[Session context:]` injected at startup.

## Threshold tuning

Too much noise → raise thresholds:

```bash
export MEM0_USER_THRESHOLD=0.45
export MEM0_AGENT_THRESHOLD=0.35
```

Missing relevant memories → lower toward `0.2`.
