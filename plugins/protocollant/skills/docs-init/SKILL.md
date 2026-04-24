---
name: docs-init
description: Scaffold the docs/ knowledge base for this project. Analyzes the codebase and creates initial versions of all managed doc files. Run this once when setting up the protocollant plugin on an existing project.
---

You are performing a one-time knowledge base initialization for this project.

## Steps

1. Check if `docs/` exists. Create it if not.

2. Run a brief codebase scan to gather initial facts:
   - Read `package.json` / `pyproject.toml` / `Cargo.toml` (whatever exists) for deps and scripts
   - Scan the top-level directory structure (2 levels deep)
   - Check for existing README, existing docs, or any architecture diagrams
   - Check for `.env.example`, `docker-compose.yml`, `Dockerfile` for infra context

3. For each of the following files, create it in `docs/` if it doesn't exist yet.
   Use the initial content format below. If a file already exists, skip it.

### docs/architecture.md

```markdown
# Architecture

> Maintained by protocollant plugin. Last updated: <date>

## Module Map

<!-- Fill in based on codebase scan -->

## Key Layers

<!-- e.g. API → Service → Repository → DB -->

## Notable Constraints

<!-- Architectural rules that must not be broken -->
```

### docs/known-issues.md

```markdown
# Known Issues

> Maintained by protocollant plugin. Last updated: <date>
> Format: [OPEN] YYYY-MM-DD — Title

<!-- Add issues here as they are discovered -->
```

### docs/resolved-bugs.md

```markdown
# Resolved Bugs

> Maintained by protocollant plugin. Last updated: <date>

<!-- Add entries as bugs are fixed -->
```

### docs/future-work.md

```markdown
# Future Work

> Maintained by protocollant plugin. Last updated: <date>

<!-- Add TODOs, feature ideas, and roadmap items here -->
```

### docs/decisions.md

```markdown
# Technical Decisions

> Maintained by protocollant plugin. Last updated: <date>
> Use this to record non-obvious choices so future agents don't re-litigate them.

<!-- Add ADR-style entries here -->
```

### docs/api-contracts.md

```markdown
# API Contracts

> Maintained by protocollant plugin. Last updated: <date>

<!-- Document endpoints and interface shapes here -->
```

### docs/data-models.md

```markdown
# Data Models

> Maintained by protocollant plugin. Last updated: <date>

<!-- Document entity shapes, schema, and migrations here -->
```

### docs/dependencies.md

```markdown
# Dependencies

> Maintained by protocollant plugin. Last updated: <date>

<!-- Document key dependency choices and rationale here -->
```

### docs/performance-notes.md

```markdown
# Performance Notes

> Maintained by protocollant plugin. Last updated: <date>

<!-- Document bottlenecks, optimizations, and benchmarks here -->
```

### docs/security-notes.md

```markdown
# Security Notes

> Maintained by protocollant plugin. Last updated: <date>

<!-- Document sensitive areas, mitigations, and threat model here -->
```

### docs/testing-strategy.md

```markdown
# Testing Strategy

> Maintained by protocollant plugin. Last updated: <date>

<!-- Document test patterns, coverage goals, and infrastructure here -->
```

### docs/deployment.md

```markdown
# Deployment

> Maintained by protocollant plugin. Last updated: <date>

<!-- Document environments, deploy process, and rollback steps here -->
```

### docs/integrations.md

```markdown
# Integrations

> Maintained by protocollant plugin. Last updated: <date>

<!-- Document third-party APIs, MCP servers, webhooks here -->
```

### docs/onboarding.md

```markdown
# Onboarding

> Maintained by protocollant plugin. Last updated: <date>

## Prerequisites

<!-- What must be installed -->

## Setup Steps

<!-- Step-by-step to get the project running -->

## Common Gotchas

<!-- Non-obvious things that trip people up -->

## Key Contacts / Resources

<!-- Links, owners -->
```

### docs/changelog.md

```markdown
# Changelog

> Maintained by protocollant plugin. Last updated: <date>

<!-- Notable changes, newest first -->
```

4. Fill in whatever you can determine from the codebase scan into the relevant files. For `architecture.md`, try to populate the Module Map and Key Layers based on the directory structure. For `dependencies.md`, list the key runtime dependencies from the package manifest with a brief note on what each is for.

5. If a `.gitignore` file exists at the project root, check whether `.protocoll-queue.local` is already listed. If not, append this line to the file:

   ```
   .claude/.protocoll-queue.local
   ```

6. Run @doc-updater to patch `CLAUDE.md` with the full routing table.

7. Report: list which files were created vs already existed, and whether `.gitignore` was updated.
