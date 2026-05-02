#!/usr/bin/env bun
// plugins/website-commenter/hooks/user-prompt-submit.js
//
// Fires when the user submits a prompt.
// Sets busy: true in the state file to signal that Claude is mid-turn.

import fs from "node:fs";

const STATE_FILE = `/tmp/claude-wc-bridge-${process.ppid}.json`;

// Consume stdin (required by hook contract)
try {
  JSON.parse(fs.readFileSync(0, "utf8"));
} catch {}

// Atomically update state file with busy: true
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
      busy: true,
      busyTs: new Date().toISOString(),
    }),
  );
  fs.renameSync(tmp, STATE_FILE);
} catch {}
