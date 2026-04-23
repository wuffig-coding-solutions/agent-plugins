import json
import os
import sys
import time
import pytest
from io import BytesIO
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError

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
