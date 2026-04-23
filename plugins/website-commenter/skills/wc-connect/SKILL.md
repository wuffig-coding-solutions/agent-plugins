---
name: wc-connect
description: Show the active bridge port so the browser extension can connect. Use when the user says "website commenter", "what port", or "connect the extension".
---

# Website Commenter — Connect the Extension

The bridge starts automatically when Claude Code launches (via MCP). To find the port for **this session**:

## Step 1 — Ensure the bridge is running

First call `get_bridge_port` on the `website-commenter` MCP server. If the tool returns a port number, the bridge is running — skip to Step 2.

If the tool returns an error indicating the bridge is stopped (e.g. port 0 or an error response), call `connect_bridge` on the same MCP server to start it. It will return the new port.

## Step 2 — Check channel status

Call the bridge health endpoint to check if channels are active:

```bash
curl -s http://localhost:{PORT}/health
```

Check the `channelActive` field in the response.

## Step 3 — Display connection instructions

**If `channelActive` is true:**

> The Website Commenter bridge for this session is running on port **{PORT}**.
>
> **In the browser extension:**
>
> 1. Open the extension popup
> 2. Paste **{PORT}** into the port field and click Connect
> 3. The extension will show a green connected indicator
>
> **Channel mode is active** — comments from the extension will immediately interrupt Claude and apply changes automatically.
>
> Use `/wc-apply` as a fallback if the automatic interrupt is not firing.

**If `channelActive` is false:**

> The Website Commenter bridge for this session is running on port **{PORT}**.
>
> **In the browser extension:**
>
> 1. Open the extension popup
> 2. Paste **{PORT}** into the port field and click Connect
> 3. The extension will show a green connected indicator
>
> **Note:** Channel mode is not active — comments won't auto-interrupt. Use `/wc-apply` to manually process staged comments.
>
> To enable auto-interrupt, restart Claude Code with:
>
> ```
> claude --channels plugin:website-commenter@agent-plugins
> ```
>
> Or add a shell alias:
>
> ```
> alias cc="claude --channels plugin:website-commenter@agent-plugins"
> ```
