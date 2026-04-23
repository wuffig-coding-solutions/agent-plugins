---
name: docs-sync
description: Manually trigger a full audit and sync of all docs/ files. Use this after a major refactor, when docs have drifted, or to force a CLAUDE.md routing table update.
---

You are performing a manual knowledge base sync for this project.

## Steps

1. Read all files in `docs/`.

2. For each file, check:
   - Is the content still accurate based on what you know about the codebase?
   - Are there obvious stale entries (references to deleted files, outdated module names)?
   - Is the format consistent with the entry format defined in `agents/doc-updater.md`? (Read that file if needed.)

3. Cross-check `architecture.md` against the actual directory structure. Note any modules that exist but aren't documented, or any documented modules that no longer exist.

4. Check `known-issues.md` — are any open issues actually resolved? If so, move them to `resolved-bugs.md` with a note.

5. Check `future-work.md` — are any TODOs already done? Move completed items to `changelog.md` as a `[DONE]` bullet and remove them from `future-work.md`.

6. Run @doc-updater to ensure `CLAUDE.md` has a current routing table.

7. Clear `.claude/doc-queue.json` (write `[]`).

8. Report a summary: which files were updated, what stale content was removed, and the current state of each doc.
