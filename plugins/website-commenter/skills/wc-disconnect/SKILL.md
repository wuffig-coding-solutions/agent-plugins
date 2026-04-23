---
name: wc-disconnect
description: Disconnect and shut down the Website Commenter bridge for this session. Use when the user says "disconnect website commenter", "stop the bridge", or "wc disconnect".
---

# Website Commenter — Disconnect

Stops the HTTP bridge server for this Claude Code session. The browser extension will show "Disconnected" after the next health check. The MCP connection stays alive so you can reconnect without restarting the session.

## Step 1 — Disconnect via MCP tool

Call the `disconnect_bridge` tool on the `website-commenter` MCP server.

If the tool call fails (e.g., bridge is not running), tell the user:

> The Website Commenter bridge is not running — nothing to disconnect.

Stop here.

## Step 2 — Confirm

Tell the user:

> The Website Commenter bridge has been shut down. The browser extension will show **Disconnected** momentarily.
>
> To reconnect, run `/wc-connect` — the bridge will start on a new port in this same session.
