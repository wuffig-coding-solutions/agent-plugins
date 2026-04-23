# Future Work

## Automated Memory Auditing

The `/mem0:audit` skill currently requires manual invocation. The natural
next step is to automate it on a schedule. Two approaches:

---

### Option A: Local cron job

Run a headless Claude Code session weekly to audit and optionally patch
the extraction prompt:

```bash
# Add to crontab: crontab -e
# Runs every Monday at 08:00
0 8 * * 1 /usr/local/bin/claude -p \
  "Run /mem0:audit and save the report to ~/mem0-audit-$(date +%Y%m%d).md. \
   If quality score < 7/10, propose concrete extraction prompt improvements \
   and write them to ~/mem0-audit-suggestions.md" \
  --output-format text \
  >> ~/logs/mem0-audit.log 2>&1
```

**Requirements:**
- Claude Code authenticated (`claude auth`)
- `MEM0_API_KEY` and `MEM0_USER_ID` in environment
- Claude Code v2.1.72+ for headless mode

---

### Option B: GitHub Actions (self-hosted runner)

For teams or if you want the audit results committed back to the repo:

```yaml
# .github/workflows/memory-audit.yml
name: Memory Audit

on:
  schedule:
    - cron: '0 8 * * 1'   # Every Monday 08:00 UTC
  workflow_dispatch:       # Allow manual trigger

jobs:
  audit:
    runs-on: self-hosted   # Needs Claude Code + mem0 access
    steps:
      - uses: actions/checkout@v4

      - name: Run memory audit
        env:
          MEM0_API_KEY: ${{ secrets.MEM0_API_KEY }}
          MEM0_USER_ID: ${{ secrets.MEM0_USER_ID }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          claude -p "Run /mem0:audit and output the report as markdown" \
            --output-format text > audit-report.md

      - name: Commit audit report
        run: |
          git config user.name "mem0-audit-bot"
          git config user.email "bot@noreply"
          git add audit-report.md
          git commit -m "chore: weekly memory audit $(date +%Y-%m-%d)" || true
          git push
```

**Note:** Requires a self-hosted GitHub Actions runner with Claude Code
installed and authenticated. Public runners won't have access to your
local mem0 instance.

---

### Option C: Extraction Prompt Auto-Improvement

More ambitious — let Claude analyze audit results and propose a patch
to `hooks/stop.py::EXTRACTION_PROMPT` directly:

```python
# Pseudocode for an auto-improve script
audit_result = run_audit()
if audit_result.quality_score < 7:
    new_prompt = claude.propose_prompt_improvement(
        current_prompt=EXTRACTION_PROMPT,
        audit_findings=audit_result.issues
    )
    # Write patch to hooks/stop.py
    # Open PR for human review
```

This should always require human review before applying — automated
prompt changes without oversight can degrade memory quality silently.

---

## Other Future Work

- **mem0 MCP self-hosted:** Currently using cloud MCP endpoint which had
  reliability issues during development. Investigate pointing the Claude.ai
  MCP config at a local mem0 instance instead.

- **Threshold auto-calibration:** Log injection events and score distributions
  to a local SQLite file, then use the data to tune `MEM0_USER_THRESHOLD`
  and `MEM0_AGENT_THRESHOLD` automatically.

- **Memory versioning:** When a fact changes ("now using X instead of Y"),
  the old memory should be marked superseded rather than deleted, for audit trail.

- **Cross-agent memory sharing:** Currently each `agent_id` is isolated.
  Explore a shared `team_id` scope for multi-developer setups.

---

## Migrate MCP transport from SSE to Streamable HTTP

**Current state:** The `.mcp.json` uses `"type": "sse"` pointing at the
Railway Gateway's `/claude/sse/[user]` endpoint.

**Why this matters:** Per the official MCP specification (protocol version
2025-11-25), SSE transport is deprecated since protocol version 2024-11-05.
Streamable HTTP is the recommended transport for all remote servers going
forward. SSE requires two separate connections (server→client unidirectional),
whereas Streamable HTTP handles bidirektionale Kommunikation in einem
einzigen Request/Response-Zyklus — stabiler auf Railway, weniger Timeouts.

**What to do when ready:**

1. Check if the mem0 Railway Gateway already exposes a Streamable HTTP endpoint
   (the spec allows servers to host both transports simultaneously):
   ```bash
   curl -X POST https://mem0-gateway-production.up.railway.app/mcp/${MEM0_RAILWAY_TOKEN}/claude/${MEM0_USER_ID} \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","method":"initialize","params":{},"id":1}'
   ```
   A 200 response means Streamable HTTP is available.

2. If yes, update `.mcp.json`:
   ```json
   {
     "mcpServers": {
       "mem0": {
         "type": "http",
         "url": "https://mem0-gateway-production.up.railway.app/mcp/${env:MEM0_RAILWAY_TOKEN}/claude/${env:MEM0_USER_ID}"
       }
     }
   }
   ```

3. If no, open an issue or PR on the mem0 Railway Gateway repository
   requesting Streamable HTTP support. Until then, SSE continues to work
   for backward compatibility — the MCP spec requires clients to support both.

**Reference:** [MCP Transports Spec](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-11-25/basic/transports.mdx)
