---
name: website-comments
description: Fetch and process pending DOM element comments sent from the browser extension. Use when the user says "check website comments", "apply website feedback", or asks about pending comments.
---

# Website Comments

## Step 1 — Find the bridge port

```bash
PORT=$(jq -r '.port // ""' /tmp/claude-wc-bridge.json 2>/dev/null)
echo "PORT=${PORT}"
```

If `PORT` is empty, tell the user:

> The Website Commenter bridge is not running. Start it first with `/website-commenter`.

Stop here.

## Step 2 — Fetch pending comments

```bash
curl -s "http://localhost:${PORT}/comments"
```

If the result is `[]`, tell the user there are no pending comments and stop.

## Step 3 — Understand each comment

For each comment you receive:

- `url` — the page where the element lives
- `comment` — what the user wants changed
- `element.selector` — CSS selector targeting the element
- `element.outerHTML` — the element's current HTML (truncated to 300 chars)
- `element.computedStyles` — live computed styles (color, font-size, etc.)
- `element.tagName`, `element.classNames`, `element.id`

## Step 4 — Apply changes

For each comment:

1. Identify the relevant source file (search by component name, selector, or class)
2. Apply the requested change
3. If ambiguous, make your best interpretation and note it

Process ALL comments before moving on.

## Step 5 — Clear processed comments

```bash
curl -s -X DELETE "http://localhost:${PORT}/comments"
```

## Step 6 — Report

Summarise what you changed, one line per comment. Flag any you couldn't action and why.
