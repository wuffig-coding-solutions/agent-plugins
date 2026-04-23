#!/usr/bin/env python3
"""PostCompact: re-inject project context after /compact."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
import _env

def main():
    c       = _env.client()
    user_id = os.environ.get("MEM0_USER_ID", "user")
    aid     = _env.agent_id()
    if not c:
        sys.exit(0)

    try:
        r = c.get_all(filters={"user_id": user_id, "agent_id": aid})
        hits = [x["memory"] for x in r.get("results", [])[:8]]
        if hits:
            print(f"[Re-injected after compaction [{aid}]:\n" +
                  "\n".join(f"- {h}" for h in hits) + "]\n")
    except Exception:
        pass

    sys.exit(0)

if __name__ == "__main__":
    main()
