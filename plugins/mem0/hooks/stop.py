#!/usr/bin/env python3
"""Stop: extract + save conversation to mem0 (native extraction)."""
import sys, json, os
sys.path.insert(0, os.path.dirname(__file__))
import _env

EXTRACTION_PROMPT = """
Extract memorable facts from this conversation as clean, atomic statements.

Rules:
- Write the fact itself — NO category labels or prefixes
- One fact per memory, no prose
- Be specific and concrete

Extract if it's:
- An architecture fact (stack, file path, port, service name)
- A decision ("using X instead of Y")
- A preference (how the user likes to work)
- A non-obvious fix ("problem was X, fix was Y")
- Something that would save time in a future project

DO NOT extract: hypotheticals, general knowledge, temporary task instructions.
"""

def main():
    c        = _env.client()
    user_id  = os.environ.get("MEM0_USER_ID", "user")
    aid      = _env.agent_id()
    max_msgs = int(os.environ.get("MEM0_MAX_MESSAGES", "20"))

    if not c:
        sys.exit(0)

    data     = json.load(sys.stdin)
    messages = data.get("messages", [])
    if len(messages) < 4:
        sys.exit(0)

    conversation = [
        {"role": m["role"], "content": m["content"]}
        for m in messages[-max_msgs:]
        if m.get("role") in ("user", "assistant")
        and m.get("content")
        and not str(m.get("content", "")).startswith("[")
    ]
    if len(conversation) < 2:
        sys.exit(0)

    try:
        c.add(conversation, user_id=user_id,
              metadata={"extraction_instructions": EXTRACTION_PROMPT})
        c.add(conversation, user_id=user_id, agent_id=aid,
              metadata={"extraction_instructions": EXTRACTION_PROMPT})
    except Exception:
        pass

    sys.exit(0)

if __name__ == "__main__":
    main()
