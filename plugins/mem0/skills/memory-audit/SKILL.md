---
name: memory-audit
description: Analyse the current state of the mem0 memory database and produce an improvement report. Use when the user asks about memory quality, duplicate memories, or wants to audit what mem0 has stored.
---

# mem0 Memory Audit

Analyse the current state of the mem0 memory database and produce an
improvement report. Called as `/mem0:audit` or invoked automatically
when the user asks about memory quality.

## What to do

1. Retrieve all memories for the current user:

   ```python
   from mem0 import MemoryClient
   import os
   client = MemoryClient(api_key=os.environ["MEM0_API_KEY"])
   user_id = os.environ.get("MEM0_USER_ID", "user")
   agent_id = os.environ.get("MEM0_AGENT_ID", "")

   user_mems = client.get_all(filters={"user_id": user_id})
   proj_mems = client.get_all(filters={"user_id": user_id, "agent_id": agent_id}) if agent_id else {"results": []}
   ```

2. Evaluate quality across these dimensions:

   **Atomicity** — Is each memory a single, self-contained fact?
   Flag: memories with conjunctions ("and", "also", "but") that could be split.

   **Specificity** — Are memories concrete enough to be useful?
   Flag: vague entries like "we discussed authentication" or "there was an issue".

   **Duplicates** — Are there semantically redundant memories?
   Flag: pairs with >80% semantic overlap.

   **Staleness** — Do any memories reference things likely outdated?
   Flag: version numbers, dates, or "current" references.

   **Extraction gaps** — What important patterns appear in conversation
   that are NOT in memory? (Review last 5 conversation turns if available.)

3. Produce a structured report:

   ```
   ## Memory Audit Report

   ### Summary
   - Total memories: N user-scope, M project-scope
   - Quality score: X/10

   ### Issues Found
   [List each issue with: memory text, issue type, suggested fix]

   ### Extraction Prompt Assessment
   [Is the current extraction prompt capturing the right things?
    What category of facts is missing or overrepresented?]

   ### Recommended Changes
   1. Split: "[memory text]" → "[fact 1]" + "[fact 2]"
   2. Delete: "[memory text]" — reason
   3. Update extraction prompt: add/remove/change rule X
   ```

4. Ask the user if they want to apply the suggested changes.
   If yes, update memories via `client.update()` or `client.delete()`.

## Notes

- Do not delete without user confirmation.
- The extraction prompt lives in `hooks/stop.py` as `EXTRACTION_PROMPT`.
  If changes are recommended, show the exact diff.
- Run this periodically (e.g. after 10+ sessions) for best results.
