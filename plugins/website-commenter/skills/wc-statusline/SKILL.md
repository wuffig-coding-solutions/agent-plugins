---
name: wc-statusline
description: Add the Website Commenter bridge indicator to the Claude Code status line. Use when the user says "add website commenter to status line", "show bridge port in status bar", or "wc status line".
---

# Website Commenter — Status Line Setup

Adds a bridge port indicator to the user's status line script so they can see at a glance whether the bridge is running and on which port. Each Claude Code session shows only its own bridge port.

## Step 1 — Check for existing status line script

```bash
cat ~/.claude/statusline-command.sh 2>/dev/null | head -5
```

If the file doesn't exist, tell the user they need a status line configured first:

> You don't have a status line script yet. Run `/statusline` first to set one up, then re-run `/wc-status` to add the bridge indicator.

Stop here.

## Step 2 — Check if the indicator is already present

Search the script for `claude-wc-bridge`:

```bash
grep -c 'claude-wc-bridge' ~/.claude/statusline-command.sh
```

If the count is > 0, tell the user the indicator is already installed and stop.

## Step 3 — Add the indicator snippet

Insert the following block **just before** the final `printf` line that outputs `$out` (typically `printf "%b%s%b" "" "$out" "$RESET"` or similar):

```bash
# ── Website Commenter bridge indicator ─────────────────────────────────────────
# Each bridge writes /tmp/claude-wc-bridge-{pid}.json. Find the one that belongs
# to this Claude Code session by walking up to our parent and finding its bridge child.
wc_indicator=""
wc_parent=$PPID
# Enumerate per-PID state files, skip dead processes, collect live ports
wc_ports=""
for wc_sf in /tmp/claude-wc-bridge-*.json; do
  [ -f "$wc_sf" ] || continue
  wc_pid=$(jq -r '.pid // ""' "$wc_sf" 2>/dev/null)
  [ -z "$wc_pid" ] && continue
  if kill -0 "$wc_pid" 2>/dev/null; then
    # Check if this bridge is a sibling (same parent = same Claude Code session)
    wc_bridge_ppid=$(ps -o ppid= -p "$wc_pid" 2>/dev/null | tr -d ' ')
    if [ "$wc_bridge_ppid" = "$wc_parent" ]; then
      wc_ports=$(jq -r '.port // ""' "$wc_sf" 2>/dev/null)
      break
    fi
  else
    # Stale file — bridge exited without cleanup
    rm -f "$wc_sf"
  fi
done
if [ -n "$wc_ports" ]; then
  wc_indicator=$(printf '\033[36mwc:%s\033[0m   ' "$wc_ports")
fi
out="${wc_indicator}${out}"
# ──────────────────────────────────────────────────────────────────────────────
```

> **Important:** The indicator uses `printf` to produce escape codes — do NOT use `"\033[..."` in a variable assignment, as bash won't interpret the escapes and they'll render as literal text.

## Step 4 — Confirm

Tell the user:

> Bridge indicator added to your status line. You should see **wc:PORT** in cyan on the left side of the bar when this session's bridge is running. Each Claude Code window shows only its own bridge port. Restart Claude Code for it to take effect.
