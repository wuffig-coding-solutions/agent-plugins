#!/usr/bin/env python3
"""UserPromptSubmit: search mem0 (dual scope) before every prompt."""
import sys, json, os
sys.path.insert(0, os.path.dirname(__file__))
import _env

def main():
    c       = _env.client()
    user_id = os.environ.get("MEM0_USER_ID", "user")
    aid     = _env.agent_id()
    top_k   = int(os.environ.get("MEM0_TOP_K", "5"))
    u_thr   = float(os.environ.get("MEM0_USER_THRESHOLD", "0.35"))
    a_thr   = float(os.environ.get("MEM0_AGENT_THRESHOLD", "0.25"))

    data   = json.load(sys.stdin)
    prompt = data.get("prompt", "")

    if len(prompt.strip()) < 15 or not c:
        print(json.dumps(data))
        sys.exit(0)

    try:
        sections = []
        q = prompt[:300]

        r = c.search(q, filters={"user_id": user_id}, top_k=top_k)
        hits = [x["memory"] for x in r.get("results", []) if x.get("score", 0) >= u_thr]
        if hits:
            sections.append("Preferences:\n" + "\n".join(f"- {h}" for h in hits))

        r2 = c.search(q, filters={"user_id": user_id, "agent_id": aid}, top_k=top_k)
        hits2 = [x["memory"] for x in r2.get("results", []) if x.get("score", 0) >= a_thr]
        if hits2:
            sections.append(f"Project [{aid}]:\n" + "\n".join(f"- {h}" for h in hits2))

        if sections:
            data["prompt"] = "[Memory:\n" + "\n\n".join(sections) + "]\n\n" + prompt
    except Exception:
        pass

    print(json.dumps(data))

if __name__ == "__main__":
    main()
