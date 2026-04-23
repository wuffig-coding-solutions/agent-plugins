#!/usr/bin/env bun
// plugins/website-commenter/hooks/session-start.js
//
// Runs at each Claude Code session start.
// The bridge is auto-started by Claude Code via the MCP server registration in plugin.json.
// This hook just surfaces the active port if the state file is already present.

import fs from "node:fs";

// Consume stdin (required by hook contract)
try {
  JSON.parse(fs.readFileSync(0, "utf8"));
} catch {}

const STATE_FILE = "/tmp/claude-wc-bridge.json";
let additionalContext = "";

if (fs.existsSync(STATE_FILE)) {
  try {
    const { port } = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (port) {
      additionalContext =
        `Website Commenter bridge is active on port ${port}. ` +
        `Enter this port in the Firefox extension to connect. ` +
        `Comments from the extension will interrupt Claude immediately via the MCP channel.`;
    }
  } catch {}
}

if (additionalContext) {
  process.stdout.write(JSON.stringify({ additionalContext }));
}
