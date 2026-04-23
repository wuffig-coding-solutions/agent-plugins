#!/usr/bin/env python3
"""SessionStart: inject user prefs + project context from mem0."""
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
        sections = []

        r = c.get_all(filters={"user_id": user_id})
        prefs = [x["memory"] for x in r.get("results", [])[:6]]
        if prefs:
            sections.append("Preferences:\n" + "\n".join(f"- {m}" for m in prefs))

        r2 = c.get_all(filters={"user_id": user_id, "agent_id": aid})
        proj = [x["memory"] for x in r2.get("results", [])[:8]]
        if proj:
            sections.append(f"Project [{aid}]:\n" + "\n".join(f"- {m}" for m in proj))

        if sections:
            print("[Session context:\n" + "\n\n".join(sections) + "]\n")
    except Exception:
        pass

    sys.exit(0)

if __name__ == "__main__":
    main()
