---
name: wc-disconnect
description: Disconnect and shut down the Website Commenter bridge for this session. Use when the user says "disconnect website commenter", "stop the bridge", or "wc disconnect".
---

# Website Commenter — Disconnect

Shuts down the bridge server for this Claude Code session. The browser extension will show "Disconnected" after the next health check. Claude Code will respawn a fresh bridge automatically if you call any website-commenter MCP tool later.

## Step 1 — Disconnect via MCP tool

Call the `disconnect_bridge` tool on the `website-commenter` MCP server.

If the tool call fails (e.g., bridge is not running), tell the user:

> The Website Commenter bridge is not running — nothing to disconnect.

Stop here.

## Step 2 — Confirm

Tell the user:

> The Website Commenter bridge has been shut down. The browser extension will show **Disconnected** momentarily.
>
> To reconnect later, run `/wc-connect` — Claude Code will start a fresh bridge automatically.
