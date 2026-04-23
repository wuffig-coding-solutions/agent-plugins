---
name: website-commenter
description: Show the active bridge port so the Firefox extension can connect. Use when the user says "website commenter", "what port", or "connect the extension".
---

# Website Commenter — Connect the Extension

The bridge starts automatically when Claude Code launches (via MCP). To find the port:

## Step 1 — Read the port

Run:

```bash
PORT=$(jq -r '.port // ""' /tmp/claude-wc-bridge.json 2>/dev/null)
echo "PORT=${PORT}"
```

If `PORT` is empty, the bridge has not started yet. This can happen on the very first session before the MCP server has initialised. Wait a moment and retry, or restart Claude Code.

## Step 2 — Display connection instructions

Tell the user:

> The Website Commenter bridge is running on port **{PORT}**.
>
> **In the Firefox extension:**
>
> 1. Open the extension popup
> 2. Paste **{PORT}** into the port field and click Connect
> 3. The extension will show a green connected indicator
>
> Once connected, any comment you send from the extension will **immediately interrupt Claude** and apply the change to the codebase — no manual command needed.
>
> Use `/website-comments` as a fallback if the automatic interrupt is not firing.
