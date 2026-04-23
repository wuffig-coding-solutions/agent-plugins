#!/usr/bin/env node
/**
 * SessionStart hook — protocollant plugin
 *
 * Reads docs/ and injects a compact routing table into additionalContext.
 * This is how Claude knows about the docs without a separate on-demand skill:
 * the knowledge is baked into the session context from the very first turn.
 *
 * Also initializes docs/ if it doesn't exist yet.
 */

const fs = require("fs");
const path = require("path");

let input;
try {
  input = JSON.parse(require("fs").readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}
const cwd = input.cwd || process.cwd();
const docsDir = path.join(cwd, "docs");
const queueFile = path.join(cwd, ".claude", "doc-queue.json");

// Doc definitions: filename → { title, loadWhen, updateOn }
const DOC_DEFINITIONS = {
  "architecture.md": {
    title: "Architecture",
    loadWhen:
      "working on system structure, modules, layers, data flow, refactoring, adding new services",
    updateOn: ["src/", "lib/", "core/", "modules/", "services/", "infra/"],
  },
  "known-issues.md": {
    title: "Known Issues",
    loadWhen:
      "debugging, investigating unexpected behavior, before starting a bug fix",
    updateOn: ["bugfix", "hotfix", "fix:", "workaround"],
  },
  "resolved-bugs.md": {
    title: "Resolved Bugs",
    loadWhen:
      "investigating a recurring issue, checking if a bug was fixed before",
    updateOn: [],
  },
  "future-work.md": {
    title: "Future Work",
    loadWhen:
      "planning new features, discussing roadmap, writing TODOs, reviewing scope",
    updateOn: ["TODO", "FIXME", "HACK", "feat:", "feature/"],
  },
  "decisions.md": {
    title: "Technical Decisions (ADR)",
    loadWhen:
      "asking why something is built a certain way, evaluating alternatives, making a non-obvious tech choice",
    updateOn: [],
  },
  "api-contracts.md": {
    title: "API Contracts",
    loadWhen:
      "working on API endpoints, changing request/response shapes, adding routes",
    updateOn: [
      "routes/",
      "api/",
      "endpoints/",
      ".schema.",
      ".contract.",
      "openapi",
    ],
  },
  "data-models.md": {
    title: "Data Models",
    loadWhen:
      "working with database schema, entities, migrations, types, or data validation",
    updateOn: [
      "models/",
      "schema/",
      "migrations/",
      ".prisma",
      ".model.",
      "entity",
    ],
  },
  "dependencies.md": {
    title: "Dependencies",
    loadWhen:
      "adding or removing packages, understanding why a dependency was chosen, evaluating alternatives",
    updateOn: [
      "package.json",
      "requirements.txt",
      "Cargo.toml",
      "go.mod",
      "pyproject.toml",
    ],
  },
  "performance-notes.md": {
    title: "Performance Notes",
    loadWhen:
      "optimizing code, investigating slow queries, working on caching, benchmarks",
    updateOn: ["perf/", "benchmark", "cache", "optimize", "index"],
  },
  "security-notes.md": {
    title: "Security Notes",
    loadWhen:
      "touching auth, permissions, secrets handling, input validation, or any security-sensitive area",
    updateOn: [
      "auth/",
      "security/",
      "secrets",
      "permissions",
      "sanitize",
      "validate",
    ],
  },
  "testing-strategy.md": {
    title: "Testing Strategy",
    loadWhen:
      "writing tests, deciding what to test, setting up test infrastructure, reviewing test coverage",
    updateOn: [
      "test/",
      "tests/",
      "__tests__/",
      ".spec.",
      ".test.",
      "vitest",
      "jest",
    ],
  },
  "deployment.md": {
    title: "Deployment",
    loadWhen:
      "deploying, configuring environments, working with CI/CD, Docker, infra-as-code",
    updateOn: [
      "Dockerfile",
      ".yml",
      ".yaml",
      "deploy/",
      "infra/",
      ".github/workflows/",
    ],
  },
  "integrations.md": {
    title: "Integrations",
    loadWhen:
      "working with third-party APIs, MCP servers, webhooks, or external services",
    updateOn: ["mcp", "webhook", "integration", "client/", "sdk/"],
  },
  "onboarding.md": {
    title: "Onboarding & Setup",
    loadWhen:
      "setting up the project fresh, explaining the codebase to a new agent/developer, troubleshooting first-run issues",
    updateOn: [],
  },
  "changelog.md": {
    title: "Changelog",
    loadWhen:
      "reviewing what changed recently, writing release notes, checking history of a module",
    updateOn: [],
  },
};

// --- Ensure docs/ exists ---
if (!fs.existsSync(docsDir)) {
  fs.mkdirSync(docsDir, { recursive: true });
}

// Clear stale queue at session start
if (fs.existsSync(queueFile)) {
  fs.writeFileSync(queueFile, JSON.stringify([], null, 2));
}

// --- Build routing table from existing docs ---
const existingDocs = fs.existsSync(docsDir)
  ? fs.readdirSync(docsDir).filter((f) => f.endsWith(".md"))
  : [];

const rows = [];
for (const [filename, def] of Object.entries(DOC_DEFINITIONS)) {
  const exists = existingDocs.includes(filename);
  const marker = exists ? "✓" : "○";
  rows.push(`${marker} docs/${filename} — ${def.loadWhen}`);
}

const untracked = existingDocs.filter((f) => !DOC_DEFINITIONS[f]);
if (untracked.length > 0) {
  rows.push(`\nUntracked docs (load manually if relevant):`);
  untracked.forEach((f) => rows.push(`  docs/${f}`));
}

const table = rows.join("\n");
const initialized = existingDocs.length > 0;

const context = `## Project Knowledge Base (protocollant plugin)

${
  initialized
    ? `The following knowledge docs are maintained automatically.\n✓ = file exists and is ready   ○ = not yet created`
    : `No docs exist yet. Run /docs-init to scaffold them, or they will be created automatically as work progresses.`
}

${table}

**Loading rule:** Read the relevant doc(s) listed above BEFORE starting any task whose description matches the "load when" condition. Do NOT load all docs by default — only load what the current task requires.

**Update rule:** After completing work that changes a domain (e.g. architecture, a bug fix, an API change), delegate to @doc-updater to keep the relevant doc current. The Stop hook will remind you if updates are pending.`;

const output = {
  additionalContext: context,
};

process.stdout.write(JSON.stringify(output));
