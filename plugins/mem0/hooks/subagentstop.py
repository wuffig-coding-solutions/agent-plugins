#!/usr/bin/env python3
"""SubagentStop: save subagent findings to project scope."""
import sys, json, os
sys.path.insert(0, os.path.dirname(__file__))
import _env

def main():
    c       = _env.client()
    user_id = os.environ.get("MEM0_USER_ID", "user")
    aid     = _env.agent_id()
    if not c:
        sys.exit(0)

    data     = json.load(sys.stdin)
    messages = data.get("messages", [])
    if len(messages) < 2:
        sys.exit(0)

    conversation = [
        {"role": m["role"], "content": m["content"]}
        for m in messages[-10:]
        if m.get("role") in ("user", "assistant") and m.get("content")
    ]
    if len(conversation) < 2:
        sys.exit(0)

    try:
        c.add(conversation, user_id=user_id, agent_id=aid,
              metadata={
                  "source": "subagent",
                  "extraction_instructions": (
                      "Extract only concrete architectural facts, file paths, "
                      "service names, patterns, or decisions discovered. "
                      "Ignore exploratory reasoning. One fact per memory."
                  )
              })
    except Exception:
        pass

    sys.exit(0)

if __name__ == "__main__":
    main()
