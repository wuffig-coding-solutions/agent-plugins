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
    """Write cfg to CONFIG_PATH as JSON, owner-only (600) from creation."""
    os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
    fd = os.open(CONFIG_PATH, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(cfg, f, indent=2)


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
    result = None
    try:
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
                result = token
                break
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

        if result is None:
            tty.write("[mem0] Authentication timed out or was denied.\n")
            tty.flush()
    finally:
        tty.close()

    return result


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
