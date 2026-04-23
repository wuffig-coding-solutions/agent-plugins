"""Shared env loader and mem0 client factory for all hooks."""
import os

def load():
    """Load .env from project dir or plugin dir."""
    candidates = [
        os.path.join(os.getcwd(), ".env"),
        os.path.expanduser("~/.claude/.env"),
    ]
    for f in candidates:
        if not os.path.exists(f):
            continue
        with open(f) as fh:
            for line in fh:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    os.environ.setdefault(k.strip(), v.strip())

def agent_id():
    """Return agent_id — auto-detected from cwd if not set."""
    aid = os.environ.get("MEM0_AGENT_ID")
    if not aid:
        aid = os.path.basename(os.getcwd()).lower().replace(" ", "-")
        os.environ["MEM0_AGENT_ID"] = aid
    return aid

def client():
    """Return MemoryClient or None if not configured."""
    load()
    key = os.environ.get("MEM0_API_KEY")
    if not key:
        return None
    try:
        from mem0 import MemoryClient
        return MemoryClient(api_key=key)
    except Exception:
        return None
