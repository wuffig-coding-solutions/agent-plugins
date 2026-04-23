#!/usr/bin/env node
/**
 * Stop hook — protocollant plugin
 *
 * Fires every time Claude finishes a response.
 * If the doc-queue is non-empty, it returns additionalContext
 * telling Claude to delegate to @doc-updater before the session ends.
 *
 * Once the doc-updater has run, it empties the queue itself.
 */

const fs = require("fs");
const path = require("path");

let input;
try {
  input = JSON.parse(fs.readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}
const cwd = input.cwd || process.cwd();
const queueFile = path.join(cwd, ".claude", "doc-queue.json");

if (!fs.existsSync(queueFile)) process.exit(0);

let queue = [];
try {
  queue = JSON.parse(fs.readFileSync(queueFile, "utf8"));
} catch {
  process.exit(0);
}

if (queue.length === 0) process.exit(0);

// Build a concise summary for Claude
const docList = queue
  .map((item) => {
    const reasons = item.reasons || [item.reason];
    return `  • docs/${item.doc}\n    Reason: ${reasons.join("; ")}`;
  })
  .join("\n");

const message = `📝 **Doc update pending** (protocollant plugin)

The following knowledge docs may be out of date due to changes made this session:

${docList}

Please delegate to @doc-updater now to update these files and sync CLAUDE.md.
@doc-updater will read the queue, update each doc with a concise structured entry, and clear the queue when done.`;

process.stdout.write(
  JSON.stringify({
    additionalContext: message,
  }),
);
