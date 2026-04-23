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
