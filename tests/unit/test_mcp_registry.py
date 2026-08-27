# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
"""Unit tests for the AWS Agent Registry MCP discovery + auto-connect module.

These tests are self-contained: they inject lightweight stub modules for the
agent-runtime-only dependencies (``mcp`` and ``strands``) into ``sys.modules``
before importing the module under test, and mock the boto3 ``agent-registry``
client. No live AWS calls, no live network, and no requirement that the heavy
agent dependencies be installed in the test environment.
"""

import importlib
import json
import sys
import types
from pathlib import Path
from unittest import mock

import pytest

# --- Make the strands pattern's package importable as a top-level "tools" pkg ---
# The module under test lives at patterns/strands-single-agent/tools/mcp_registry.py
# and imports siblings as ``from tools...`` at runtime (matching the container's
# working directory). Add that pattern directory to sys.path so ``tools`` resolves.
_PATTERN_DIR = Path(__file__).resolve().parents[2] / "patterns" / "strands-single-agent"


def _install_dependency_stubs() -> None:
    """Register minimal stubs for ``mcp`` and ``strands`` in sys.modules.

    Only the symbols imported by ``mcp_registry`` are provided:
    ``mcp.client.streamable_http.streamablehttp_client`` and
    ``strands.tools.mcp.MCPClient``. Each is a plain callable/class recording its
    arguments so tests can assert how the module used them.
    """
    # mcp.client.streamable_http.streamablehttp_client
    mcp_pkg = types.ModuleType("mcp")
    mcp_client_pkg = types.ModuleType("mcp.client")
    mcp_http_mod = types.ModuleType("mcp.client.streamable_http")

    def _streamablehttp_client(url: str):
        """Stub transport factory: returns a marker capturing the URL."""
        return ("streamablehttp_client", url)

    mcp_http_mod.streamablehttp_client = _streamablehttp_client
    mcp_client_pkg.streamable_http = mcp_http_mod
    mcp_pkg.client = mcp_client_pkg
    sys.modules["mcp"] = mcp_pkg
    sys.modules["mcp.client"] = mcp_client_pkg
    sys.modules["mcp.client.streamable_http"] = mcp_http_mod

    # strands.tools.mcp.MCPClient
    strands_pkg = types.ModuleType("strands")
    strands_tools_pkg = types.ModuleType("strands.tools")
    strands_mcp_mod = types.ModuleType("strands.tools.mcp")

    class _MCPClient:
        """Stub MCPClient recording the factory result and prefix."""

        def __init__(self, factory, prefix=None):
            self.prefix = prefix
            # Invoke the factory immediately so tests can see the captured URL.
            self.factory_result = factory()

    strands_mcp_mod.MCPClient = _MCPClient
    strands_tools_pkg.mcp = strands_mcp_mod
    strands_pkg.tools = strands_tools_pkg
    sys.modules["strands"] = strands_pkg
    sys.modules["strands.tools"] = strands_tools_pkg
    sys.modules["strands.tools.mcp"] = strands_mcp_mod


@pytest.fixture()
def mcp_registry(monkeypatch):
    """Import (fresh) the module under test with dependency stubs installed."""
    _install_dependency_stubs()
    monkeypatch.syspath_prepend(str(_PATTERN_DIR))
    # Ensure a clean import each test so module-level state can't leak.
    sys.modules.pop("tools.mcp_registry", None)
    module = importlib.import_module("tools.mcp_registry")
    return importlib.reload(module)


def _fake_client(list_pages, batch_response):
    """Build a mock boto3 agent-registry client.

    Args:
        list_pages: Iterable of pages returned by the list paginator.
        batch_response: The dict returned by batch_get_discoverable_registry_record.

    Returns:
        mock.Mock: A client whose paginator yields ``list_pages`` and whose
        batch-get returns ``batch_response``.
    """
    client = mock.Mock()
    paginator = mock.Mock()
    # Return a fresh iterator on every paginate() call so the fake client can be
    # used by more than one discovery pass (e.g. discover() then build()).
    paginator.paginate.side_effect = lambda *a, **k: iter(list_pages)
    client.get_paginator.return_value = paginator
    client.batch_get_discoverable_registry_record.return_value = batch_response
    return client


# ---------------------------------------------------------------------------
# is_discovery_enabled
# ---------------------------------------------------------------------------
def test_disabled_by_default(mcp_registry, monkeypatch):
    monkeypatch.delenv("MCP_REGISTRY_DISCOVERY_ENABLED", raising=False)
    assert mcp_registry.is_discovery_enabled() is False


def test_enabled_case_insensitive(mcp_registry, monkeypatch):
    monkeypatch.setenv("MCP_REGISTRY_DISCOVERY_ENABLED", "TRUE")
    assert mcp_registry.is_discovery_enabled() is True


# ---------------------------------------------------------------------------
# discover_registry_mcp_servers / build_registry_mcp_clients
# ---------------------------------------------------------------------------
def test_disabled_returns_no_servers_and_no_calls(mcp_registry, monkeypatch):
    monkeypatch.setenv("MCP_REGISTRY_DISCOVERY_ENABLED", "false")
    with mock.patch.object(mcp_registry, "_registry_client") as client_factory:
        assert mcp_registry.discover_registry_mcp_servers() == []
        assert mcp_registry.build_registry_mcp_clients() == []
        client_factory.assert_not_called()


def test_enabled_without_registry_id_fails_loud(mcp_registry, monkeypatch):
    monkeypatch.setenv("MCP_REGISTRY_DISCOVERY_ENABLED", "true")
    monkeypatch.delenv("MCP_REGISTRY_ID", raising=False)
    with pytest.raises(ValueError, match="MCP_REGISTRY_ID"):
        mcp_registry.discover_registry_mcp_servers()


def _mcp_record(record_id, name, url, transport="streamable-http", as_dict=False):
    """Build a registry record matching the real batch-get shape.

    The registry stores the MCP server definition under
    ``descriptors.mcpServer.data`` as a JSON **string** (per the live API). Set
    ``as_dict=True`` to instead place an already-parsed object in ``data`` (the
    forward-compatible branch the module also handles). ``url``/``transport`` may
    be None to model a record missing its endpoint.
    """
    remotes = []
    if url is not None:
        remote = {"url": url}
        if transport is not None:
            remote["type"] = transport
        remotes = [remote]
    definition = {"name": name, "version": "1.0.0", "remotes": remotes}
    data = definition if as_dict else json.dumps(definition)
    return {
        "recordId": record_id,
        "displayName": name,
        "recordType": "MCP",
        "descriptors": {"mcpServer": {"data": data, "dataSchemaVersion": "2025-12-11"}},
    }


def test_happy_path_discovers_and_builds_clients(mcp_registry, monkeypatch):
    monkeypatch.setenv("MCP_REGISTRY_DISCOVERY_ENABLED", "true")
    monkeypatch.setenv("MCP_REGISTRY_ID", "my-registry")
    monkeypatch.setenv("AWS_REGION", "us-east-1")

    list_pages = [
        {"registryRecords": [{"recordId": "rec-1", "name": "Weather"}]},
        {"registryRecords": [{"recordId": "rec-2", "name": "Docs Server"}]},
    ]
    batch_response = {
        "registryRecords": [
            _mcp_record("rec-1", "Weather", "https://weather.example/mcp"),
            _mcp_record("rec-2", "Docs Server", "https://docs.example/mcp"),
        ],
        "errors": [],
    }
    client = _fake_client(list_pages, batch_response)

    with mock.patch.object(mcp_registry, "_registry_client", return_value=client):
        servers = mcp_registry.discover_registry_mcp_servers()
        assert [s.url for s in servers] == [
            "https://weather.example/mcp",
            "https://docs.example/mcp",
        ]

        clients = mcp_registry.build_registry_mcp_clients()

    assert len(clients) == 2
    # Prefixes are slugified and namespaced.
    assert clients[0].prefix == "registry_weather"
    assert clients[1].prefix == "registry_docs_server"
    # Each client's factory captured its own endpoint URL (no closure late-binding bug).
    assert clients[0].factory_result == (
        "streamablehttp_client",
        "https://weather.example/mcp",
    )
    assert clients[1].factory_result == (
        "streamablehttp_client",
        "https://docs.example/mcp",
    )


def test_duplicate_names_get_distinct_prefixes(mcp_registry, monkeypatch):
    """Two records that slugify to the same prefix must not collide."""
    monkeypatch.setenv("MCP_REGISTRY_DISCOVERY_ENABLED", "true")
    monkeypatch.setenv("MCP_REGISTRY_ID", "my-registry")
    list_pages = [
        {
            "registryRecords": [
                {"recordId": "r1", "name": "AWS Knowledge"},
                {"recordId": "r2", "name": "aws-knowledge"},
            ]
        }
    ]
    batch_response = {
        "registryRecords": [
            _mcp_record("r1", "AWS Knowledge", "https://a.example/mcp"),
            _mcp_record("r2", "aws-knowledge", "https://b.example/mcp"),
        ],
        "errors": [],
    }
    client = _fake_client(list_pages, batch_response)
    with mock.patch.object(mcp_registry, "_registry_client", return_value=client):
        clients = mcp_registry.build_registry_mcp_clients()
    prefixes = [c.prefix for c in clients]
    assert len(prefixes) == 2
    assert len(set(prefixes)) == 2, f"prefixes collided: {prefixes}"
    assert prefixes[0] == "registry_aws_knowledge"
    assert prefixes[1] == "registry_aws_knowledge_2"


def test_long_name_prefix_is_capped(mcp_registry, monkeypatch):
    """A very long record name must not blow past Bedrock's tool-name limit."""
    monkeypatch.setenv("MCP_REGISTRY_DISCOVERY_ENABLED", "true")
    monkeypatch.setenv("MCP_REGISTRY_ID", "my-registry")
    long_name = "Super Long AWS Service Documentation And Knowledge MCP Server Name"
    list_pages = [{"registryRecords": [{"recordId": "rL", "name": long_name}]}]
    batch_response = {
        "registryRecords": [_mcp_record("rL", long_name, "https://l.example/mcp")],
        "errors": [],
    }
    client = _fake_client(list_pages, batch_response)
    with mock.patch.object(mcp_registry, "_registry_client", return_value=client):
        clients = mcp_registry.build_registry_mcp_clients()
    # prefix = "registry_" (9) + capped slug (<=24) => <= 33 chars, leaving room
    # for "_<tool_name>" within Bedrock's 64-char tool-name limit.
    assert len(clients) == 1
    assert clients[0].prefix.startswith("registry_")
    assert (
        len(clients[0].prefix) <= len("registry_") + mcp_registry._MAX_PREFIX_SLUG_LEN
    )


def test_empty_registry_returns_nothing(mcp_registry, monkeypatch):
    monkeypatch.setenv("MCP_REGISTRY_DISCOVERY_ENABLED", "true")
    monkeypatch.setenv("MCP_REGISTRY_ID", "my-registry")
    client = _fake_client(
        [{"registryRecords": []}], {"registryRecords": [], "errors": []}
    )
    with mock.patch.object(mcp_registry, "_registry_client", return_value=client):
        assert mcp_registry.discover_registry_mcp_servers() == []
        # batch-get should not even be attempted when there are no record ids.
        client.batch_get_discoverable_registry_record.assert_not_called()


def test_unsupported_transport_is_skipped(mcp_registry, monkeypatch):
    monkeypatch.setenv("MCP_REGISTRY_DISCOVERY_ENABLED", "true")
    monkeypatch.setenv("MCP_REGISTRY_ID", "my-registry")
    list_pages = [{"registryRecords": [{"recordId": "rec-sse", "name": "SSE"}]}]
    batch_response = {
        "registryRecords": [
            _mcp_record("rec-sse", "SSE", "https://sse.example/mcp", transport="sse"),
        ],
        "errors": [],
    }
    client = _fake_client(list_pages, batch_response)
    with mock.patch.object(mcp_registry, "_registry_client", return_value=client):
        assert mcp_registry.discover_registry_mcp_servers() == []


def test_missing_url_is_skipped(mcp_registry, monkeypatch):
    monkeypatch.setenv("MCP_REGISTRY_DISCOVERY_ENABLED", "true")
    monkeypatch.setenv("MCP_REGISTRY_ID", "my-registry")
    list_pages = [{"registryRecords": [{"recordId": "rec-x", "name": "NoUrl"}]}]
    batch_response = {
        "registryRecords": [
            _mcp_record("rec-x", "NoUrl", url=None),
        ],
        "errors": [],
    }
    client = _fake_client(list_pages, batch_response)
    with mock.patch.object(mcp_registry, "_registry_client", return_value=client):
        assert mcp_registry.discover_registry_mcp_servers() == []


def test_registry_unreachable_fails_soft(mcp_registry, monkeypatch):
    monkeypatch.setenv("MCP_REGISTRY_DISCOVERY_ENABLED", "true")
    monkeypatch.setenv("MCP_REGISTRY_ID", "my-registry")
    client = mock.Mock()
    client.get_paginator.side_effect = RuntimeError("network down")
    with mock.patch.object(mcp_registry, "_registry_client", return_value=client):
        # Fail-soft: no exception propagates, empty result.
        assert mcp_registry.discover_registry_mcp_servers() == []
        assert mcp_registry.build_registry_mcp_clients() == []


def test_absent_transport_defaults_to_supported(mcp_registry, monkeypatch):
    monkeypatch.setenv("MCP_REGISTRY_DISCOVERY_ENABLED", "true")
    monkeypatch.setenv("MCP_REGISTRY_ID", "my-registry")
    list_pages = [{"registryRecords": [{"recordId": "rec-a", "name": "Ambient"}]}]
    batch_response = {
        "registryRecords": [
            # No "type" on the remote — treated as the supported default.
            _mcp_record("rec-a", "Ambient", "https://a.example/mcp", transport=None),
        ],
        "errors": [],
    }
    client = _fake_client(list_pages, batch_response)
    with mock.patch.object(mcp_registry, "_registry_client", return_value=client):
        servers = mcp_registry.discover_registry_mcp_servers()
    assert len(servers) == 1
    assert servers[0].transport == "streamable-http"


def test_descriptor_data_as_parsed_dict(mcp_registry, monkeypatch):
    """The module also accepts an already-parsed dict in descriptors.mcpServer.data."""
    monkeypatch.setenv("MCP_REGISTRY_DISCOVERY_ENABLED", "true")
    monkeypatch.setenv("MCP_REGISTRY_ID", "my-registry")
    list_pages = [{"registryRecords": [{"recordId": "rec-d", "name": "DictData"}]}]
    batch_response = {
        "registryRecords": [
            _mcp_record("rec-d", "DictData", "https://dict.example/mcp", as_dict=True),
        ],
        "errors": [],
    }
    client = _fake_client(list_pages, batch_response)
    with mock.patch.object(mcp_registry, "_registry_client", return_value=client):
        servers = mcp_registry.discover_registry_mcp_servers()
    assert len(servers) == 1
    assert servers[0].url == "https://dict.example/mcp"
