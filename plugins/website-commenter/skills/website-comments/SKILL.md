---
name: website-comments
description: Fetch and process pending DOM element comments sent from the browser extension. Use when the user says "check website comments", "apply website feedback", or asks about pending comments from the extension.
---

# Website Comments

You are processing DOM element annotations sent from the browser extension. Each comment targets a specific element on a webpage and describes a change the user wants.

## Step 1 — Fetch pending comments

```bash
curl -s http://localhost:8789/comments
```

If the result is an empty array `[]`, tell the user there are no pending comments and stop.

## Step 2 — Understand the context

For each comment, you receive:

- `url` — the page where the element lives
- `comment` — what the user wants changed
- `element.selector` — CSS selector targeting the element
- `element.outerHTML` — the element's current HTML (truncated)
- `element.computedStyles` — live computed styles (color, font-size, etc.)
- `element.tagName`, `element.classNames`, `element.id`

## Step 3 — Apply changes

For each comment:

1. Identify the relevant source file in the current project (search by component name, selector, or class)
2. Apply the requested change
3. If a comment is ambiguous, make your best interpretation and note it

Process ALL comments before moving on — do not stop after the first one.

## Step 4 — Clear processed comments

```bash
curl -s -X DELETE http://localhost:8789/comments
```

## Step 5 — Report

Summarise what you changed, one line per comment. Flag any comments you couldn't action and why.
