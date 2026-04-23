---
name: website-commenter
description: Start the website commenter bridge server so the Firefox extension can connect. Use when the user says "start website commenter", "start the bridge", or "connect the extension".
---

# Website Commenter — Start Bridge

## Step 1 — Check if already running

Run:

```bash
PORT=""
STATUS=""
if [ -f /tmp/claude-wc-bridge.json ]; then
  PORT=$(jq -r '.port // ""' /tmp/claude-wc-bridge.json 2>/dev/null)
  STATUS=$(curl -sf --max-time 1 "http://localhost:${PORT}/health" 2>/dev/null \
    | jq -r '.status // ""' 2>/dev/null)
fi
echo "PORT=${PORT} STATUS=${STATUS}"
```

If output shows `STATUS=ok`, tell the user:

> The Website Commenter bridge is already running on port **{PORT}**. Paste this into the Firefox extension if you haven't already.

Stop here. If the state file existed but the health check failed (bridge crashed), clean up and continue:

```bash
rm -f /tmp/claude-wc-bridge.json
```

## Step 2 — Start the bridge

```bash
bash ~/.claude/wc-start.sh &
sleep 0.6
```

## Step 3 — Read the port

```bash
PORT=$(jq -r '.port // ""' /tmp/claude-wc-bridge.json 2>/dev/null)
echo "PORT=${PORT}"
```

If `PORT` is empty, tell the user:

> The bridge failed to start. Make sure Bun is installed (`bun --version`) and try again.

Stop here.

## Step 4 — Display connection instructions

Tell the user:

> ✓ Website Commenter bridge is running on port **{PORT}**.
>
> **In the Firefox extension:**
>
> 1. Open the extension popup
> 2. Paste **{PORT}** into the port field and click Connect
> 3. The extension will show a green connected indicator
>
> Use `/website-comments` to fetch and apply any pending feedback.
