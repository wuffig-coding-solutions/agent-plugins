---
name: wc-connect
description: Show the active bridge port so the Firefox extension can connect. Use when the user says "website commenter", "what port", or "connect the extension".
---

# Website Commenter — Connect the Extension

The bridge starts automatically when Claude Code launches (via MCP). To find the port for **this session**:

## Step 1 — Ensure the bridge is running

First call `get_bridge_port` on the `website-commenter` MCP server. If the tool returns a port number, the bridge is running — skip to Step 2.

If the tool returns an error indicating the bridge is stopped (e.g. port 0 or an error response), call `connect_bridge` on the same MCP server to start it. It will return the new port.

## Step 2 — Display connection instructions

Tell the user:

> The Website Commenter bridge for this session is running on port **{PORT}**.
>
> **In the browser extension:**
>
> 1. Open the extension popup
> 2. Paste **{PORT}** into the port field and click Connect
> 3. The extension will show a green connected indicator
>
> Once connected, any comment you send from the extension will **immediately interrupt Claude** and apply the change to the codebase — no manual command needed.
>
> Use `/wc-apply` as a fallback if the automatic interrupt is not firing.
