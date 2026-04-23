---
name: wc-status
description: Add the Website Commenter bridge indicator to the Claude Code status line. Use when the user says "add website commenter to status line", "show bridge port in status bar", or "wc status line".
---

# Website Commenter — Status Line Setup

Adds a bridge port indicator to the user's status line script so they can see at a glance whether the bridge is running and on which port.

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
wc_indicator=""
if [ -f /tmp/claude-wc-bridge.json ]; then
  wc_port=$(jq -r '.port // ""' /tmp/claude-wc-bridge.json 2>/dev/null)
  if [ -n "$wc_port" ]; then
    wc_indicator=$(printf '\033[36m⬡ :%s\033[0m   ' "$wc_port")
  fi
fi
out="${wc_indicator}${out}"
# ──────────────────────────────────────────────────────────────────────────────
```

> **Important:** The indicator must use `printf` to produce the escape codes — do NOT use `"\033[..."` in a variable assignment, as bash won't interpret the escapes and they'll render as literal text.

## Step 4 — Confirm

Tell the user:

> Bridge indicator added to your status line. You should see **⬡ :PORT** in cyan on the left side of the bar when the bridge is running. Restart Claude Code for it to take effect.
