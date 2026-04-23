---
name: website-commenter
description: Show the active bridge port so the Firefox extension can connect. Use when the user says "website commenter", "what port", or "connect the extension".
---

# Website Commenter — Connect the Extension

The bridge starts automatically when Claude Code launches (via MCP). To find the port for **this session**:

## Step 1 — Get the port via MCP tool

Call the `get_bridge_port` tool on the `website-commenter` MCP server. It returns the exact port this session's bridge is listening on.

> **Why not read `/tmp/claude-wc-bridge.json`?** That file is shared across all Claude Code sessions. With multiple windows open, it shows the last bridge to start — which may not be yours.

## Step 2 — Display connection instructions

Tell the user:

> The Website Commenter bridge for this session is running on port **{PORT}**.
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
