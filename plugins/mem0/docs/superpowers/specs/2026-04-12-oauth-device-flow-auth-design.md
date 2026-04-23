# OAuth Device Flow Auth — Design Spec

**Date:** 2026-04-12  
**Status:** Approved

## Problem

The plugin hooks authenticate with mem0 via a static `MEM0_API_KEY` stored in `~/.claude/.env`. This requires manual credential management. The Railway gateway already enforces Auth0 OAuth2 for the MCP connection; the hooks should use the same mechanism instead of a separate static key.

## Goal

Replace `MEM0_API_KEY` in the hooks with Auth0 Device Authorization Flow. First run: combined setup quiz + browser auth. Every subsequent run: silent token reuse or background refresh. No env vars, no hardcoded secrets, no changes to any hook file.

---

## Architecture

### What changes

| File               | Change                                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `hooks/auth.py`    | **New.** Config collection (first-run quiz via `/dev/tty`) + Device Flow token acquisition + token cache management    |
| `hooks/gateway.py` | **New.** `GatewayClient` — drop-in HTTP replacement for `MemoryClient`, calls gateway REST endpoints with Bearer token |
| `hooks/_env.py`    | **Updated.** `client()` tries OAuth path first, falls back to `MEM0_API_KEY` for backward compatibility                |

### What doesn't change

All 7 hook files (`sessionstart.py`, `userpromptsubmit.py`, `stop.py`, `postcompact.py`, `subagentstart.py`, `subagentstop.py`, `hooks.json`). They call `c.add()`, `c.search()`, `c.get_all()` exactly as today.

### Flow

```
hook calls _env.client()
    │
    ├── auth.get_config() → config exists?
    │       no  → /dev/tty quiz → save ~/.claude/.mem0-config.json
    │       yes → load config
    │
    ├── auth.get_token(config) → valid cached token?
    │       yes → return access_token  (fast path, no network)
    │       expired → POST /oauth/token with refresh_token → update cache
    │       none/refresh failed → Device Flow:
    │           POST /oauth/device/code
    │           print to /dev/tty: "Open https://... to authenticate"
    │           poll /oauth/token until success → cache token
    │
    └── return GatewayClient(gateway_url, token)
            ↓
        fallback: MemoryClient(api_key=MEM0_API_KEY) if no config
            ↓
        fallback: None (hooks skip silently)
```

---

## Component Design

### `hooks/auth.py`

**Responsibilities:**

- First-run detection (no `~/.claude/.mem0-config.json`)
- Interactive config collection via `/dev/tty` (works even when hook stdin is occupied by Claude's JSON payload)
- Device Authorization Flow token acquisition
- Token cache read/write with expiry check
- Silent refresh via refresh token

**Config file:** `~/.claude/.mem0-config.json`

```json
{
  "auth0_domain": "dev-xyz.eu.auth0.com",
  "auth0_client_id": "...",
  "auth0_audience": "https://your-api-identifier",
  "gateway_url": "https://mem0-gateway-production.up.railway.app",
  "user_id": "niklas"
}
```

**Token cache:** stored inside `~/.claude/.mem0-config.json` under a `token` key (single file):

```json
{
  ...,
  "token": {
    "access_token": "eyJ...",
    "refresh_token": "v1.xxx",
    "expires_at": 1712345678
  }
}
```

**Device Flow sequence:**

1. `POST https://{domain}/oauth/device/code` — params: `client_id`, `scope=openid offline_access`, `audience`
2. Print to `/dev/tty`: `[mem0] Open this URL to authenticate: https://...`
3. Poll `POST https://{domain}/oauth/token` every `interval` seconds:
   - `authorization_pending` → keep polling
   - `slow_down` → increase interval by 5s
   - `expired_token` / `access_denied` → return None (hook skips this run)
   - `200 OK` → cache token, return access_token

**Refresh sequence:**

- If `expires_at - now < 60` → `POST /oauth/token` with `grant_type=refresh_token`
- On success → update cache, return new access_token
- On failure → re-run Device Flow

**Auth0 application requirements:**

- Application Type: **Native**
- Grant Types: **Device Code** enabled
- No client_secret required (public client)

### `hooks/gateway.py`

**Responsibilities:**

- Drop-in replacement for `MemoryClient` with identical method signatures
- HTTP calls to gateway REST endpoints using `urllib` (stdlib, no new dependencies)
- `Authorization: Bearer <token>` on every request

**Methods:**

```
add(messages, user_id, agent_id=None, metadata=None)
    → POST {gateway_url}/api/v1/memories/

search(query, filters, top_k)
    → POST {gateway_url}/api/v1/memories/search/

get_all(filters)
    → GET {gateway_url}/api/v1/memories/?user_id=...&agent_id=...
```

**Note:** exact endpoint paths (`/api/v1/...`) depend on how `API_UPSTREAM` is configured in the Railway gateway. Confirm against live gateway during implementation before hardcoding.

**Error handling:** all methods wrapped in `try/except`, returning `{"results": []}` on failure. Memory ops are best-effort and never block Claude.

### Updated `hooks/_env.py`

`client()` updated — everything else in `_env.py` unchanged:

```python
def client():
    load()
    try:
        import auth, gateway
        cfg = auth.get_config()
        if cfg:
            token = auth.get_token(cfg)
            if token:
                return gateway.GatewayClient(cfg["gateway_url"], token)
    except Exception:
        pass
    # legacy fallback
    key = os.environ.get("MEM0_API_KEY")
    if not key:
        return None
    try:
        from mem0 import MemoryClient
        return MemoryClient(api_key=key)
    except Exception:
        return None
```

---

## First-Run Experience

On the very first hook invocation with no config:

```
[mem0] First-time setup — this runs once.

Auth0 domain (e.g. dev-xyz.eu.auth0.com): _
Auth0 client ID: _
Auth0 audience (API identifier): _
Gateway URL [https://mem0-gateway-production.up.railway.app]: _
Your user ID (e.g. niklas): _

Config saved. Authenticating...

[mem0] Open this URL to authenticate:
https://dev-xyz.eu.auth0.com/activate?user_code=XXXX-XXXX

Waiting...
✓ Authenticated. Token cached.
```

After this, every hook run is fully silent.

---

## Environment Variables

None required. All config collected once via the quiz and stored in `~/.claude/.mem0-config.json`.

**Backward compatibility:** `MEM0_API_KEY` in `~/.claude/.env` still works as a fallback if no config file is present.

---

## Out of Scope

- Re-run / update flow for existing config (delete `~/.claude/.mem0-config.json` and re-run to reconfigure)
- Windows support (`/dev/tty` is macOS/Linux only — acceptable for this use case)
- Token revocation / logout command
