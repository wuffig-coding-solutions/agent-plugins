#!/usr/bin/env node
/**
 * PostToolUse hook — protocollant plugin
 *
 * Fires after every Edit/Write/MultiEdit tool call.
 * Detects which knowledge domain(s) the changed file belongs to
 * and appends to a queue file. The Stop hook later reads this
 * queue and tells Claude to call @doc-updater.
 *
 * Runs silently — no output unless a relevant change is detected.
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
const toolInput = input.tool_input || {};
const changedFile = toolInput.path || toolInput.file_path || "";

if (!changedFile) process.exit(0);

const queueFile = path.join(cwd, ".claude", "doc-queue.json");
const rel = path.relative(cwd, changedFile);

// Ignore files outside the project root
if (rel.startsWith("..")) process.exit(0);

// Map file path patterns → doc file + reason
const RULES = [
  {
    patterns: [
      "src/",
      "lib/",
      "core/",
      "modules/",
      "services/",
      "infra/",
      "packages/",
    ],
    doc: "architecture.md",
    reason: `Structural change in ${rel}`,
  },
  {
    patterns: [
      "routes/",
      "api/",
      "endpoints/",
      ".schema.",
      ".contract.",
      "openapi",
      "swagger",
    ],
    doc: "api-contracts.md",
    reason: `API-relevant change in ${rel}`,
  },
  {
    patterns: [
      "models/",
      "schema/",
      "migrations/",
      ".prisma",
      "entity/",
      ".model.",
    ],
    doc: "data-models.md",
    reason: `Data model change in ${rel}`,
  },
  {
    patterns: [
      "package.json",
      "requirements.txt",
      "Cargo.toml",
      "go.mod",
      "pyproject.toml",
      "pnpm-lock",
      "yarn.lock",
      "bun.lock",
    ],
    doc: "dependencies.md",
    reason: `Dependency file changed: ${rel}`,
  },
  {
    patterns: [
      "Dockerfile",
      ".github/workflows/",
      "deploy/",
      "infra/",
      "k8s/",
      "terraform/",
      "docker-compose",
      ".yml",
      ".yaml",
    ],
    doc: "deployment.md",
    reason: `Deployment config changed: ${rel}`,
  },
  {
    patterns: [
      "test/",
      "tests/",
      "__tests__/",
      "spec/",
      ".spec.",
      ".test.",
      "vitest.config",
      "jest.config",
    ],
    doc: "testing-strategy.md",
    reason: `Test file changed: ${rel}`,
  },
  {
    patterns: [
      "auth/",
      "security/",
      "permissions/",
      "secrets",
      "sanitize",
      "validate",
      "csrf",
      "cors",
    ],
    doc: "security-notes.md",
    reason: `Security-sensitive change in ${rel}`,
  },
  {
    patterns: [
      "mcp/",
      "webhook",
      "integration/",
      "client/",
      "sdk/",
      "third-party/",
    ],
    doc: "integrations.md",
    reason: `Integration-related change in ${rel}`,
  },
  {
    patterns: ["perf/", "benchmark", "cache/", "optimize/", "index/"],
    doc: "performance-notes.md",
    reason: `Performance-related change in ${rel}`,
  },
];

// Check which docs need updating
const pending = [];
for (const rule of RULES) {
  const match = rule.patterns.some((p) => rel.includes(p));
  if (match) {
    pending.push({ doc: rule.doc, reason: rule.reason, file: rel });
  }
}

// Architecture catch-all: any source file not already matched and not a test
const isSourceFile = /\.(ts|js|tsx|jsx|py|go|rs|rb|java|kt|swift)$/.test(rel);
const alreadyHasArch = pending.some((p) => p.doc === "architecture.md");
const isTestFile =
  rel.includes("/test/") ||
  rel.includes("/tests/") ||
  rel.includes("/__tests__/") ||
  rel.includes(".test.") ||
  rel.includes(".spec.");
if (isSourceFile && !alreadyHasArch && !isTestFile) {
  pending.push({
    doc: "architecture.md",
    reason: `Source file changed: ${rel}`,
  });
}

if (pending.length === 0) process.exit(0);

// Append to queue (dedup by doc, always normalize to reasons[])
let queue = [];
if (fs.existsSync(queueFile)) {
  try {
    queue = JSON.parse(fs.readFileSync(queueFile, "utf8"));
  } catch {}
}

for (const item of pending) {
  const existing = queue.find((q) => q.doc === item.doc);
  if (!existing) {
    queue.push({ doc: item.doc, reasons: [item.reason], file: item.file });
  } else {
    // Normalize legacy entries that used singular `reason`
    if (!existing.reasons) existing.reasons = [existing.reason];
    if (!existing.reasons.includes(item.reason)) {
      existing.reasons.push(item.reason);
    }
  }
}

fs.mkdirSync(path.dirname(queueFile), { recursive: true });
fs.writeFileSync(queueFile, JSON.stringify(queue, null, 2));

process.exit(0);
