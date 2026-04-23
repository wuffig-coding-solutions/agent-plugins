# OAuth Device Flow Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace static `MEM0_API_KEY` in hooks with Auth0 Device Flow — first run shows a setup quiz + browser auth prompt; every subsequent run is silent via cached/refreshed tokens.

**Architecture:** Two new files (`hooks/auth.py`, `hooks/gateway.py`) plus a small update to `hooks/_env.py`. `auth.py` manages config collection and OAuth tokens. `gateway.py` is a drop-in HTTP replacement for `MemoryClient`. All 7 hook files are untouched.

**Tech Stack:** Python 3 stdlib only (`urllib`, `json`, `os`, `time`). pytest for tests.

---

## File Map

| Action | File                    | Responsibility                                                           |
| ------ | ----------------------- | ------------------------------------------------------------------------ |
| Create | `hooks/auth.py`         | Config file R/W, first-run quiz via `/dev/tty`, Device Flow, token cache |
| Create | `hooks/gateway.py`      | `GatewayClient` — drop-in for `MemoryClient`, calls `/api/v1/memories/*` |
| Modify | `hooks/_env.py`         | `client()` tries OAuth path first, falls back to `MEM0_API_KEY`          |
| Create | `tests/__init__.py`     | Empty — makes `tests/` a package                                         |
| Create | `tests/test_auth.py`    | Unit tests for `auth.py`                                                 |
| Create | `tests/test_gateway.py` | Unit tests for `gateway.py`                                              |

**Config file:** `~/.claude/.mem0-config.json`

```json
{
  "auth0_domain": "dev-xyz.eu.auth0.com",
  "auth0_client_id": "...",
  "auth0_audience": "https://your-api-identifier",
  "gateway_url": "https://mem0-gateway-production.up.railway.app",
  "user_id": "niklas",
  "token": {
    "access_token": "eyJ...",
    "refresh_token": "v1.xxx",
    "expires_at": 1712345678
  }
}
```

---

## Task 1: Test infrastructure

**Files:**

- Create: `tests/__init__.py`
- Create: `tests/test_auth.py`
- Create: `tests/test_gateway.py`

- [ ] **Step 1: Install pytest**

```bash
pip install pytest
```

Expected: `Successfully installed pytest-...`

- [ ] **Step 2: Create test package**

```bash
mkdir -p tests
touch tests/__init__.py
```

- [ ] **Step 3: Create placeholder test files**

`tests/test_auth.py`:

```python
# Auth module tests — populated in Tasks 2–5
```

`tests/test_gateway.py`:

```python
# GatewayClient tests — populated in Task 6
```

- [ ] **Step 4: Verify pytest runs**

```bash
cd /Users/ephandor/Documents/GitHub/mem0-plugin
python3 -m pytest tests/ -v
```

Expected: `no tests ran` (0 collected), exit 0.

- [ ] **Step 5: Commit**

```bash
git add tests/
git commit -m "test: add test scaffolding"
```

---

## Task 2: auth.py — config read/write

**Files:**

- Create: `hooks/auth.py`
- Modify: `tests/test_auth.py`

- [ ] **Step 1: Write failing tests for `get_config` and `save_config`**

Replace `tests/test_auth.py` with:

```python
import json
import os
import sys
import time
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "hooks"))

import auth

REQUIRED_KEYS = ("auth0_domain", "auth0_client_id", "auth0_audience", "gateway_url", "user_id")

def valid_config():
    return {
        "auth0_domain": "dev-test.eu.auth0.com",
        "auth0_client_id": "test_client_id",
        "auth0_audience": "https://api.test.com",
        "gateway_url": "https://gateway.test.com",
        "user_id": "testuser",
    }


def test_get_config_returns_none_when_file_missing(tmp_path, monkeypatch):
    monkeypatch.setattr(auth, "CONFIG_PATH", str(tmp_path / "config.json"))
    assert auth.get_config() is None


def test_get_config_returns_dict_when_valid(tmp_path, monkeypatch):
    config_path = tmp_path / "config.json"
    cfg = valid_config()
    config_path.write_text(json.dumps(cfg))
    monkeypatch.setattr(auth, "CONFIG_PATH", str(config_path))
    assert auth.get_config() == cfg


def test_get_config_returns_none_when_key_missing(tmp_path, monkeypatch):
    config_path = tmp_path / "config.json"
    config_path.write_text(json.dumps({"auth0_domain": "x"}))  # missing 4 keys
    monkeypatch.setattr(auth, "CONFIG_PATH", str(config_path))
    assert auth.get_config() is None


def test_save_config_writes_json(tmp_path, monkeypatch):
    config_path = tmp_path / "config.json"
    monkeypatch.setattr(auth, "CONFIG_PATH", str(config_path))
    cfg = valid_config()
    auth.save_config(cfg)
    on_disk = json.loads(config_path.read_text())
    assert on_disk == cfg
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
python3 -m pytest tests/test_auth.py -v
```

Expected: `ImportError: cannot import name 'auth'` or `ModuleNotFoundError`.

- [ ] **Step 3: Create `hooks/auth.py` with config functions**

```python
"""Auth0 Device Flow token management for mem0 hooks."""
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

CONFIG_PATH = os.path.expanduser("~/.claude/.mem0-config.json")

_REQUIRED = ("auth0_domain", "auth0_client_id", "auth0_audience", "gateway_url", "user_id")


def get_config():
    """Return config dict or None if file missing or incomplete."""
    if not os.path.exists(CONFIG_PATH):
        return None
    try:
        with open(CONFIG_PATH) as f:
            cfg = json.load(f)
        if all(k in cfg for k in _REQUIRED):
            return cfg
    except Exception:
        pass
    return None


def save_config(cfg):
    """Write cfg to CONFIG_PATH as JSON."""
    with open(CONFIG_PATH, "w") as f:
        json.dump(cfg, f, indent=2)
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
python3 -m pytest tests/test_auth.py -v
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add hooks/auth.py tests/test_auth.py
git commit -m "feat: add auth config read/write"
```

---

## Task 3: auth.py — token cache fast path

**Files:**

- Modify: `hooks/auth.py`
- Modify: `tests/test_auth.py`

- [ ] **Step 1: Add failing tests for cached token path**

Append to `tests/test_auth.py`:

```python
def test_get_token_returns_cached_when_valid(tmp_path, monkeypatch):
    cfg = valid_config()
    cfg["token"] = {
        "access_token": "cached_token_xyz",
        "refresh_token": "some_refresh",
        "expires_at": time.time() + 3600,
    }
    monkeypatch.setattr(auth, "CONFIG_PATH", str(tmp_path / "config.json"))
    assert auth.get_token(cfg) == "cached_token_xyz"


def test_get_token_skips_expired_cache(tmp_path, monkeypatch):
    """Expired token should NOT be returned (falls through to refresh)."""
    cfg = valid_config()
    cfg["token"] = {
        "access_token": "stale_token",
        "refresh_token": "bad_refresh",
        "expires_at": time.time() - 100,  # expired
    }
    monkeypatch.setattr(auth, "CONFIG_PATH", str(tmp_path / "config.json"))
    # No mock for HTTP — refresh will fail → get_token returns None
    result = auth.get_token(cfg)
    assert result != "stale_token"
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
python3 -m pytest tests/test_auth.py::test_get_token_returns_cached_when_valid tests/test_auth.py::test_get_token_skips_expired_cache -v
```

Expected: `AttributeError: module 'auth' has no attribute 'get_token'`.

- [ ] **Step 3: Add `get_token` skeleton to `hooks/auth.py`**

Append to `hooks/auth.py`:

```python
def get_token(cfg):
    """Return a valid access token, refreshing or re-authenticating as needed.
    Returns None if authentication is not possible (e.g. during Device Flow wait).
    """
    token_data = cfg.get("token") or {}

    # Fast path: cached token still valid
    if token_data.get("access_token") and token_data.get("expires_at", 0) - time.time() > 60:
        return token_data["access_token"]

    # Try silent refresh
    if token_data.get("refresh_token"):
        try:
            resp = _post(
                f"https://{cfg['auth0_domain']}/oauth/token",
                {
                    "grant_type": "refresh_token",
                    "client_id": cfg["auth0_client_id"],
                    "refresh_token": token_data["refresh_token"],
                },
            )
            _update_token_cache(cfg, resp)
            return resp["access_token"]
        except Exception:
            pass

    # Device Flow (may be slow on first run — runs quiz inline if needed)
    token_resp = _device_flow(cfg)
    if token_resp:
        _update_token_cache(cfg, token_resp)
        return token_resp["access_token"]

    return None


def _update_token_cache(cfg, token_resp):
    """Persist token fields into cfg and write to disk."""
    existing_refresh = (cfg.get("token") or {}).get("refresh_token")
    cfg["token"] = {
        "access_token": token_resp["access_token"],
        "refresh_token": token_resp.get("refresh_token") or existing_refresh,
        "expires_at": time.time() + token_resp.get("expires_in", 86400),
    }
    save_config(cfg)
```

Add stubs for the not-yet-implemented helpers so the module imports:

```python
def _post(url, data):
    raise NotImplementedError

def _device_flow(cfg):
    return None
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
python3 -m pytest tests/test_auth.py -v
```

Expected: 6 passed (`test_get_token_skips_expired_cache` passes because `_device_flow` returns None, so `get_token` returns None ≠ "stale_token").

- [ ] **Step 5: Commit**

```bash
git add hooks/auth.py tests/test_auth.py
git commit -m "feat: add token cache fast path and refresh skeleton"
```

---

## Task 4: auth.py — token refresh and Device Flow

**Files:**

- Modify: `hooks/auth.py`
- Modify: `tests/test_auth.py`

- [ ] **Step 1: Add failing tests for refresh and Device Flow**

Append to `tests/test_auth.py`:

```python
from unittest.mock import patch, MagicMock
from urllib.error import HTTPError
from io import BytesIO


def _make_urlopen_response(data):
    """Context manager mock that returns JSON-encoded data from .read()."""
    m = MagicMock()
    m.__enter__ = lambda self: self
    m.__exit__ = MagicMock(return_value=False)
    m.read.return_value = json.dumps(data).encode()
    return m


def _make_http_error(error_code):
    body = BytesIO(json.dumps({"error": error_code}).encode())
    return HTTPError(url="", code=400, msg="Bad Request", hdrs=None, fp=body)


def test_get_token_refreshes_expired_token(tmp_path, monkeypatch):
    config_path = tmp_path / "config.json"
    monkeypatch.setattr(auth, "CONFIG_PATH", str(config_path))

    cfg = valid_config()
    cfg["token"] = {
        "access_token": "old_token",
        "refresh_token": "valid_refresh_token",
        "expires_at": time.time() - 100,  # expired
    }

    refresh_response = {"access_token": "refreshed_token", "expires_in": 86400}

    with patch("urllib.request.urlopen", return_value=_make_urlopen_response(refresh_response)):
        result = auth.get_token(cfg)

    assert result == "refreshed_token"


def test_get_token_falls_back_to_device_flow_on_refresh_failure(tmp_path, monkeypatch):
    config_path = tmp_path / "config.json"
    monkeypatch.setattr(auth, "CONFIG_PATH", str(config_path))

    cfg = valid_config()
    cfg["token"] = {
        "access_token": "old_token",
        "refresh_token": "revoked_refresh",
        "expires_at": time.time() - 100,
    }

    device_flow_token = {"access_token": "device_flow_token", "refresh_token": "new_refresh", "expires_in": 86400}

    responses = iter([
        _make_http_error("invalid_grant"),        # refresh fails
        _make_urlopen_response({"device_code": "DC", "user_code": "AB-CD",
                                "verification_uri_complete": "https://x.com/activate",
                                "interval": 0, "expires_in": 300}),  # device/code
        _make_urlopen_response(device_flow_token),  # poll → success
    ])

    def side_effect(req, timeout=None):
        resp = next(responses)
        if isinstance(resp, HTTPError):
            raise resp
        return resp

    with patch("urllib.request.urlopen", side_effect=side_effect):
        with patch("builtins.open", side_effect=lambda p, *a, **kw: open(str(config_path), *a, **kw) if p != "/dev/tty" else MagicMock(write=lambda s: None, flush=lambda: None, close=lambda: None)):
            result = auth.get_token(cfg)

    assert result == "device_flow_token"


def test_device_flow_returns_none_on_expired_device_code(tmp_path, monkeypatch):
    config_path = tmp_path / "config.json"
    monkeypatch.setattr(auth, "CONFIG_PATH", str(config_path))

    cfg = valid_config()

    responses = iter([
        _make_urlopen_response({"device_code": "DC", "user_code": "AB-CD",
                                "verification_uri_complete": "https://x.com/activate",
                                "interval": 0, "expires_in": 0}),  # expires immediately
        _make_http_error("expired_token"),
    ])

    def side_effect(req, timeout=None):
        resp = next(responses)
        if isinstance(resp, HTTPError):
            raise resp
        return resp

    with patch("urllib.request.urlopen", side_effect=side_effect):
        with patch("builtins.open", side_effect=lambda p, *a, **kw: open(str(config_path), *a, **kw) if p != "/dev/tty" else MagicMock(write=lambda s: None, flush=lambda: None, close=lambda: None)):
            result = auth._device_flow(cfg)

    assert result is None
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
python3 -m pytest tests/test_auth.py::test_get_token_refreshes_expired_token tests/test_auth.py::test_get_token_falls_back_to_device_flow_on_refresh_failure tests/test_auth.py::test_device_flow_returns_none_on_expired_device_code -v
```

Expected: all 3 fail (`NotImplementedError` from `_post` stub).

- [ ] **Step 3: Replace `_post` and `_device_flow` stubs in `hooks/auth.py`**

Remove the two stub functions and replace with:

```python
def _post(url, data):
    """POST application/x-www-form-urlencoded. Returns parsed JSON.
    Raises urllib.error.HTTPError on non-2xx (caller reads .read() for error body).
    """
    body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(url, data=body)
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())


def _device_flow(cfg):
    """Run Auth0 Device Authorization Flow. Returns token dict or None."""
    try:
        data = _post(
            f"https://{cfg['auth0_domain']}/oauth/device/code",
            {
                "client_id": cfg["auth0_client_id"],
                "scope": "openid offline_access",
                "audience": cfg["auth0_audience"],
            },
        )
    except Exception:
        return None

    device_code = data["device_code"]
    interval = int(data.get("interval", 5))
    expires_in = int(data.get("expires_in", 900))
    url = data.get("verification_uri_complete") or data.get("verification_uri", "")

    tty = open("/dev/tty", "w")
    tty.write(f"\n[mem0] Open this URL to authenticate:\n{url}\n\nWaiting...\n")
    tty.flush()

    deadline = time.time() + expires_in
    while time.time() < deadline:
        time.sleep(interval)
        try:
            token = _post(
                f"https://{cfg['auth0_domain']}/oauth/token",
                {
                    "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                    "device_code": device_code,
                    "client_id": cfg["auth0_client_id"],
                },
            )
            tty.write("\u2713 Authenticated. Token cached.\n")
            tty.flush()
            tty.close()
            return token
        except urllib.error.HTTPError as e:
            err_body = json.loads(e.read())
            err = err_body.get("error", "")
            if err == "authorization_pending":
                continue
            elif err == "slow_down":
                interval += 5
                continue
            else:
                break  # expired_token, access_denied, etc.
        except Exception:
            break

    tty.write("[mem0] Authentication timed out or was denied.\n")
    tty.flush()
    tty.close()
    return None
```

- [ ] **Step 4: Add `_prompt_config` and `ensure_config` to `hooks/auth.py`**

Append to `hooks/auth.py`:

```python
def _prompt_config():
    """Collect config interactively via /dev/tty. Returns config dict."""
    tty = open("/dev/tty", "r+")

    def ask(prompt, default=None):
        display = f"{prompt} [{default}]: " if default else f"{prompt}: "
        tty.write(display)
        tty.flush()
        answer = tty.readline().strip()
        return answer if answer else default

    tty.write("\n[mem0] First-time setup \u2014 this runs once.\n\n")
    tty.flush()

    cfg = {
        "auth0_domain": ask("Auth0 domain (e.g. dev-xyz.eu.auth0.com)"),
        "auth0_client_id": ask("Auth0 client ID"),
        "auth0_audience": ask("Auth0 audience (API identifier)"),
        "gateway_url": ask(
            "Gateway URL",
            "https://mem0-gateway-production.up.railway.app",
        ),
        "user_id": ask("Your user ID (e.g. niklas)"),
    }
    tty.write("\nConfig saved. Authenticating...\n")
    tty.flush()
    tty.close()
    return cfg


def ensure_config():
    """Return config dict, running setup quiz if config file is missing."""
    cfg = get_config()
    if cfg is None:
        cfg = _prompt_config()
        save_config(cfg)
    return cfg
```

- [ ] **Step 5: Run all tests to confirm they pass**

```bash
python3 -m pytest tests/test_auth.py -v
```

Expected: 9 passed.

- [ ] **Step 6: Commit**

```bash
git add hooks/auth.py tests/test_auth.py
git commit -m "feat: implement Device Flow, token refresh, and first-run setup quiz"
```

---

## Task 5: gateway.py — GatewayClient

**Files:**

- Create: `hooks/gateway.py`
- Modify: `tests/test_gateway.py`

- [ ] **Step 1: Write failing tests**

Replace `tests/test_gateway.py` with:

```python
import json
import os
import sys
import pytest
from unittest.mock import patch, MagicMock
from urllib.error import HTTPError
from io import BytesIO

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "hooks"))

import gateway


BASE_URL = "https://gateway.test.com"
TOKEN = "test_bearer_token"


def make_response(data):
    m = MagicMock()
    m.__enter__ = lambda self: self
    m.__exit__ = MagicMock(return_value=False)
    m.read.return_value = json.dumps(data).encode()
    return m


def get_request_args(mock_urlopen):
    """Extract the Request object passed to urlopen."""
    return mock_urlopen.call_args[0][0]


def test_add_sends_post_with_bearer_token():
    client = gateway.GatewayClient(BASE_URL, TOKEN)
    response_data = {"results": []}

    with patch("urllib.request.urlopen", return_value=make_response(response_data)) as mock_urlopen:
        client.add(
            [{"role": "user", "content": "hello"}],
            user_id="niklas",
            agent_id="myproject",
            metadata={"key": "val"},
        )

    req = get_request_args(mock_urlopen)
    assert req.full_url == f"{BASE_URL}/api/v1/memories/"
    assert req.method == "POST"
    assert req.get_header("Authorization") == f"Bearer {TOKEN}"
    body = json.loads(req.data)
    assert body["user_id"] == "niklas"
    assert body["agent_id"] == "myproject"
    assert body["metadata"] == {"key": "val"}


def test_add_omits_agent_id_when_none():
    client = gateway.GatewayClient(BASE_URL, TOKEN)

    with patch("urllib.request.urlopen", return_value=make_response({})) as mock_urlopen:
        client.add([{"role": "user", "content": "hi"}], user_id="niklas")

    body = json.loads(get_request_args(mock_urlopen).data)
    assert "agent_id" not in body


def test_search_sends_post_with_query_and_filters():
    client = gateway.GatewayClient(BASE_URL, TOKEN)
    response_data = {"results": [{"memory": "fact", "score": 0.9}]}

    with patch("urllib.request.urlopen", return_value=make_response(response_data)) as mock_urlopen:
        result = client.search("what is X", filters={"user_id": "niklas"}, top_k=3)

    req = get_request_args(mock_urlopen)
    assert req.full_url == f"{BASE_URL}/api/v1/memories/search/"
    assert req.method == "POST"
    body = json.loads(req.data)
    assert body["query"] == "what is X"
    assert body["top_k"] == 3
    assert body["filters"] == {"user_id": "niklas"}
    assert result == response_data


def test_get_all_sends_get_with_filter_params():
    client = gateway.GatewayClient(BASE_URL, TOKEN)
    response_data = {"results": [{"memory": "fact"}]}

    with patch("urllib.request.urlopen", return_value=make_response(response_data)) as mock_urlopen:
        result = client.get_all(filters={"user_id": "niklas", "agent_id": "proj"})

    req = get_request_args(mock_urlopen)
    assert req.method == "GET"
    assert "user_id=niklas" in req.full_url
    assert "agent_id=proj" in req.full_url
    assert result == response_data


def test_get_all_without_filters_sends_bare_url():
    client = gateway.GatewayClient(BASE_URL, TOKEN)

    with patch("urllib.request.urlopen", return_value=make_response({"results": []})) as mock_urlopen:
        client.get_all()

    req = get_request_args(mock_urlopen)
    assert req.full_url == f"{BASE_URL}/api/v1/memories/"


def test_returns_empty_results_on_http_error():
    client = gateway.GatewayClient(BASE_URL, TOKEN)

    error = HTTPError(url="", code=401, msg="Unauthorized", hdrs=None, fp=BytesIO(b"{}"))
    with patch("urllib.request.urlopen", side_effect=error):
        result = client.add([{"role": "user", "content": "hi"}], user_id="niklas")

    assert result == {"results": []}


def test_returns_empty_results_on_connection_error():
    client = gateway.GatewayClient(BASE_URL, TOKEN)

    with patch("urllib.request.urlopen", side_effect=OSError("connection refused")):
        result = client.search("query", filters={"user_id": "x"}, top_k=5)

    assert result == {"results": []}
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
python3 -m pytest tests/test_gateway.py -v
```

Expected: `ModuleNotFoundError: No module named 'gateway'`.

- [ ] **Step 3: Create `hooks/gateway.py`**

```python
"""HTTP client for mem0 gateway REST API — drop-in for MemoryClient."""
import json
import urllib.error
import urllib.parse
import urllib.request

_EMPTY = {"results": []}


class GatewayClient:
    def __init__(self, base_url, token):
        self._base = base_url.rstrip("/")
        self._token = token

    def _request(self, method, path, body=None):
        url = self._base + path
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Authorization", f"Bearer {self._token}")
        if data:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                return json.loads(resp.read())
        except Exception:
            return _EMPTY

    def add(self, messages, user_id, agent_id=None, metadata=None):
        payload = {"messages": messages, "user_id": user_id}
        if agent_id is not None:
            payload["agent_id"] = agent_id
        if metadata is not None:
            payload["metadata"] = metadata
        return self._request("POST", "/api/v1/memories/", payload)

    def search(self, query, filters=None, top_k=5):
        payload = {"query": query, "top_k": top_k}
        if filters:
            payload["filters"] = filters
        return self._request("POST", "/api/v1/memories/search/", payload)

    def get_all(self, filters=None):
        if filters:
            qs = urllib.parse.urlencode(filters)
            path = f"/api/v1/memories/?{qs}"
        else:
            path = "/api/v1/memories/"
        return self._request("GET", path)
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
python3 -m pytest tests/test_gateway.py -v
```

Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add hooks/gateway.py tests/test_gateway.py
git commit -m "feat: add GatewayClient HTTP drop-in for MemoryClient"
```

---

## Task 6: Verify gateway endpoint paths

**Files:** none (manual verification, then possibly update `hooks/gateway.py`)

The `GatewayClient` uses `/api/v1/memories/` and `/api/v1/memories/search/`. These must match what your Railway nginx config forwards to the upstream. Verify before going live.

- [ ] **Step 1: Confirm your Auth0 application is set up**

In the Auth0 dashboard:

1. Application Type → **Native**
2. Advanced Settings → Grant Types → **Device Code** enabled
3. Note `AUTH0_DOMAIN` and `AUTH0_CLIENT_ID`
4. Confirm `AUTH0_AUDIENCE` matches an existing API identifier under Auth0 → APIs

- [ ] **Step 2: Get a test Bearer token using curl**

```bash
# Replace values with your actual Auth0 credentials
AUTH0_DOMAIN="dev-xyz.eu.auth0.com"
CLIENT_ID="your_client_id"
AUDIENCE="https://your-api-identifier"

# Step 1: request device code
curl -s -X POST "https://$AUTH0_DOMAIN/oauth/device/code" \
  -d "client_id=$CLIENT_ID&scope=openid offline_access&audience=$AUDIENCE" \
  | python3 -m json.tool
```

Open the `verification_uri_complete` URL in your browser, authenticate, then:

```bash
# Replace DEVICE_CODE with value from above response
DEVICE_CODE="the_device_code_from_above"

curl -s -X POST "https://$AUTH0_DOMAIN/oauth/token" \
  -d "grant_type=urn:ietf:params:oauth:grant-type:device_code&device_code=$DEVICE_CODE&client_id=$CLIENT_ID" \
  | python3 -m json.tool
```

Copy the `access_token` from the response.

- [ ] **Step 3: Probe the gateway REST endpoints**

```bash
GATEWAY="https://mem0-gateway-production.up.railway.app"
TOKEN="paste_access_token_here"

# Test GET /api/v1/memories/
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  "$GATEWAY/api/v1/memories/?user_id=test"
```

Expected: `200` or `404` (not `401` or `502`). If `401` → token or audience mismatch. If `502` → upstream is down.

```bash
# Test POST /api/v1/memories/search/
curl -s -w "\n%{http_code}" \
  -X POST "$GATEWAY/api/v1/memories/search/" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"test","top_k":1,"filters":{"user_id":"test"}}'
```

- [ ] **Step 4: If paths are wrong, update `hooks/gateway.py`**

If the actual paths differ (e.g. `/v1/memories/` instead of `/api/v1/memories/`), update the three path strings in `GatewayClient`:

```python
# In add():
return self._request("POST", "/v1/memories/", payload)   # ← update if needed

# In search():
return self._request("POST", "/v1/memories/search/", payload)  # ← update if needed

# In get_all():
path = f"/v1/memories/?{qs}"   # ← update if needed
path = "/v1/memories/"         # ← update if needed
```

Re-run tests after any path change:

```bash
python3 -m pytest tests/test_gateway.py -v
```

Update test URLs to match:

```python
# In tests/test_gateway.py, update all assertions like:
assert req.full_url == f"{BASE_URL}/v1/memories/"  # match actual paths
```

- [ ] **Step 5: Commit (if paths changed)**

```bash
git add hooks/gateway.py tests/test_gateway.py
git commit -m "fix: update gateway endpoint paths to match Railway config"
```

---

## Task 7: Update `hooks/_env.py`

**Files:**

- Modify: `hooks/_env.py`

- [ ] **Step 1: Replace `client()` in `hooks/_env.py`**

Current `client()` (lines 28–38):

```python
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
```

Replace with:

```python
def client():
    """Return GatewayClient (OAuth) or MemoryClient (API key) or None."""
    load()
    try:
        import auth
        import gateway
        cfg = auth.ensure_config()
        # Propagate user_id from config so hooks work without MEM0_USER_ID env var
        if cfg.get("user_id"):
            os.environ.setdefault("MEM0_USER_ID", cfg["user_id"])
        token = auth.get_token(cfg)
        if token:
            return gateway.GatewayClient(cfg["gateway_url"], token)
    except Exception:
        pass
    # Legacy fallback: MEM0_API_KEY in environment
    key = os.environ.get("MEM0_API_KEY")
    if not key:
        return None
    try:
        from mem0 import MemoryClient
        return MemoryClient(api_key=key)
    except Exception:
        return None
```

Also update the docstring at the top of `_env.py` line 1:

```python
"""Shared env loader and mem0 client factory for all hooks."""
```

No change needed — keep as-is.

- [ ] **Step 2: Run the full test suite**

```bash
python3 -m pytest tests/ -v
```

Expected: all tests pass (the `_env.py` change is not unit-tested here — covered by the smoke test).

- [ ] **Step 3: Commit**

```bash
git add hooks/_env.py
git commit -m "feat: wire OAuth path into _env.client() with API key fallback"
```

---

## Task 8: End-to-end smoke test

**Files:** none (manual verification)

- [ ] **Step 1: Back up and remove the config file (forces first-run)**

```bash
cp ~/.claude/.mem0-config.json ~/.claude/.mem0-config.json.bak 2>/dev/null || true
rm -f ~/.claude/.mem0-config.json
```

- [ ] **Step 2: Trigger a hook manually**

```bash
echo '{"messages":[]}' | python3 hooks/sessionstart.py
```

Expected: the quiz prints to your terminal, then the Device Flow URL appears. Complete authentication in browser.

- [ ] **Step 3: Verify config and token were saved**

```bash
python3 -c "
import json
with open('/Users/ephandor/.claude/.mem0-config.json') as f:
    cfg = json.load(f)
print('Config keys:', list(cfg.keys()))
print('Token present:', 'token' in cfg)
print('Access token starts with:', cfg.get('token', {}).get('access_token', '')[:20])
"
```

Expected:

```
Config keys: ['auth0_domain', 'auth0_client_id', 'auth0_audience', 'gateway_url', 'user_id', 'token']
Token present: True
Access token starts with: eyJ...
```

- [ ] **Step 4: Confirm second run is silent**

```bash
echo '{"messages":[]}' | python3 hooks/sessionstart.py
```

Expected: no output (no quiz, no auth prompt). Completes in < 1 second.

- [ ] **Step 5: Run full test suite one final time**

```bash
python3 -m pytest tests/ -v
```

Expected: all tests pass.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: OAuth Device Flow auth complete — hooks use gateway via Bearer token"
```

- [ ] **Step 7: Restore backup if needed**

```bash
# Only if you want to go back to the old config:
# cp ~/.claude/.mem0-config.json.bak ~/.claude/.mem0-config.json
```
