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
