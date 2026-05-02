#!/usr/bin/env bun
// plugins/website-commenter/hooks/subagent-stop.js
//
// Defensive copy of stop.js for the SubagentStop event.
// Fires when a subagent finishes execution.
// Sets busy: false in the state file to signal that Claude is ready for new input.

import fs from "node:fs";

const STATE_FILE = `/tmp/claude-wc-bridge-${process.ppid}.json`;

// Consume stdin (required by hook contract)
try {
  JSON.parse(fs.readFileSync(0, "utf8"));
} catch {}

// Atomically update state file with busy: false
try {
  let current = {};
  try {
    current = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {}
  const tmp = STATE_FILE + ".tmp";
  fs.writeFileSync(
    tmp,
    JSON.stringify({
      ...current,
      busy: false,
      busyTs: new Date().toISOString(),
    }),
  );
  fs.renameSync(tmp, STATE_FILE);
} catch {}
