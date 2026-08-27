"""Discover MCP servers from an AWS Agent Registry and auto-connect them.

This module lets the FAST agent discover MCP-server records published in an
`AWS Agent Registry <https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/registry.html>`_
at runtime and connect to them as live Strands ``MCPClient`` tool providers, so
their tools become directly callable by the agent — with no hand-maintained
catalog, no DynamoDB, and no UI.

Discovery uses the ``agent-registry`` data-plane APIs (the ``bedrock-agentcore``
namespace is deprecated after 2026-09-17 and does not expose these APIs):

* ``list_discoverable_registry_records`` — paginated summaries of *Approved*
  records; filtered here to ``recordType == "MCP"``.
* ``batch_get_discoverable_registry_record`` — full descriptor content, from
  which the streamable-HTTP endpoint URL is read (``mcpServer.remotes[0].url``).

Environment (set by the infrastructure only when the feature is enabled):
    MCP_REGISTRY_DISCOVERY_ENABLED  — "true" to activate; anything else disables.
    MCP_REGISTRY_ID                 — ARN or id of the AWS Agent Registry.
    AWS_REGION / AWS_DEFAULT_REGION — region of the registry.

Design contract:
    * Fail loud on misconfiguration: if discovery is enabled but no registry id
      is configured, :func:`build_registry_mcp_clients` raises ``ValueError`` so
      the deployment error is obvious rather than silently doing nothing.
    * Fail soft on runtime/registry errors: if the registry is unreachable or an
      individual record is malformed, that server is skipped with a logged
      warning and the agent keeps responding on its remaining tools.
    * v1 connects only *public* ``streamable-http`` records. Records using any
      other transport, or advertising authentication requirements, are logged
      and skipped (per-server OAuth is a documented follow-up).
"""

import json
import logging
import os
import re
from dataclasses import dataclass

import boto3
from mcp.client.streamable_http import streamablehttp_client
from strands.tools.mcp import MCPClient

logger = logging.getLogger(__name__)

# Registry record filter: only Model Context Protocol server records.
_MCP_RECORD_TYPE = "MCP"

# The only transport this version can auto-connect. AgentCore Gateway and the
# registry both speak streamable HTTP MCP; SSE and stdio are not connected here.
_SUPPORTED_TRANSPORT = "streamable-http"

# Max length of the slug portion of a client prefix. Keeps the full tool name
# ("registry_<slug>_<tool_name>") within Bedrock's 64-char tool-name limit.
_MAX_PREFIX_SLUG_LEN = 24


@dataclass(frozen=True)
class DiscoveredMcpServer:
    """A single MCP server discovered from the AWS Agent Registry.

    Attributes:
        record_id: The registry record id (or ARN) the server was discovered from.
        name: Human-readable record name, used to derive a safe client prefix.
        url: The streamable-HTTP MCP endpoint URL (``remotes[0].url``).
        transport: The advertised transport type (e.g. ``"streamable-http"``).
    """

    record_id: str
    name: str
    url: str
    transport: str


def is_discovery_enabled() -> bool:
    """Return whether registry-based MCP discovery is switched on.

    Returns:
        bool: True only when ``MCP_REGISTRY_DISCOVERY_ENABLED`` is the string
        ``"true"`` (case-insensitive); False otherwise.
    """
    return os.environ.get("MCP_REGISTRY_DISCOVERY_ENABLED", "false").lower() == "true"


def _get_registry_id() -> str:
    """Read and validate the configured registry id.

    Returns:
        str: The non-empty registry id/ARN from ``MCP_REGISTRY_ID``.

    Raises:
        ValueError: If discovery is enabled but no registry id is configured.
            Failing loud here surfaces the deployment mistake instead of
            silently connecting zero servers.
    """
    registry_id = os.environ.get("MCP_REGISTRY_ID", "").strip()
    if not registry_id:
        raise ValueError(
            "MCP_REGISTRY_DISCOVERY_ENABLED is 'true' but MCP_REGISTRY_ID is not set. "
            "Set the AWS Agent Registry id/ARN or disable discovery."
        )
    return registry_id


def _registry_client() -> "boto3.client":
    """Create a boto3 client for the AWS Agent Registry data plane.

    Returns:
        boto3.client: A client for the ``agent-registry`` service bound to the
        region from ``AWS_REGION`` / ``AWS_DEFAULT_REGION`` (default us-east-1).
    """
    region = os.environ.get("AWS_REGION") or os.environ.get(
        "AWS_DEFAULT_REGION", "us-east-1"
    )
    return boto3.client("agent-registry", region_name=region)


def _safe_prefix(name: str) -> str:
    """Derive a Strands client prefix from a record name.

    Strands prefixes each MCP client's tool names with ``{prefix}_``; the prefix
    must be a simple token so the resulting tool names stay valid and readable.
    The slug is length-capped because the full gateway/registry tool name
    (``{prefix}_{tool_name}``) must stay within Bedrock's 64-character tool-name
    limit — an over-long registry name would otherwise push tool names past it
    and the agent would reject them.

    Args:
        name: The registry record's human-readable name.

    Returns:
        str: ``registry_<slug>`` where ``<slug>`` is the lowercased name with any
        run of non-alphanumeric characters collapsed to a single underscore,
        truncated to keep the prefix short.
    """
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", name).strip("_").lower()
    # Cap the slug so "registry_<slug>_<toolname>" stays well under 64 chars.
    slug = slug[:_MAX_PREFIX_SLUG_LEN].strip("_")
    return f"registry_{slug or 'server'}"


def _extract_endpoint(record: dict) -> tuple[str | None, str | None]:
    """Pull the MCP endpoint URL and transport from a full registry record.

    The registry stores the MCP server definition under
    ``record["descriptors"]["mcpServer"]``. In practice the definition lives in
    the ``data`` field as a **JSON string** conforming to the MCP server schema,
    whose ``remotes`` array carries the connection details (only the first remote
    is used). This helper is tolerant of shape variation: ``data`` may be a JSON
    string or an already-parsed object, and ``remotes`` may sit directly on the
    ``mcpServer`` object.

    Args:
        record: A full record object as returned by
            ``batch_get_discoverable_registry_record`` (includes ``descriptors``).

    Returns:
        tuple[str | None, str | None]: ``(url, transport)``. Either element is
        None when it cannot be located.
    """
    if not isinstance(record, dict):
        return None, None

    # Plural "descriptors" is the real key; tolerate a singular "descriptor" too.
    descriptors = record.get("descriptors") or record.get("descriptor") or {}
    mcp_server = (
        descriptors.get("mcpServer", {}) if isinstance(descriptors, dict) else {}
    )
    if not isinstance(mcp_server, dict):
        return None, None

    # The MCP server definition is normally a JSON string in "data".
    definition: dict = {}
    data = mcp_server.get("data")
    if isinstance(data, str) and data.strip():
        try:
            definition = json.loads(data)
        except (ValueError, TypeError):
            logger.warning("[MCP-REGISTRY] mcpServer.data is not valid JSON; skipping")
            return None, None
    elif isinstance(data, dict):
        definition = data

    # remotes may live inside the parsed definition or directly on mcp_server.
    remotes = definition.get("remotes") if isinstance(definition, dict) else None
    if not remotes:
        remotes = mcp_server.get("remotes")
    if not remotes or not isinstance(remotes, list) or not isinstance(remotes[0], dict):
        return None, None

    first = remotes[0]
    return first.get("url"), first.get("type")


def discover_registry_mcp_servers() -> list[DiscoveredMcpServer]:
    """Discover approved streamable-HTTP MCP servers from the registry.

    Lists all *Approved* ``recordType == "MCP"`` records (paginated), fetches
    their full descriptors in a single batch call, and returns one
    :class:`DiscoveredMcpServer` per record that advertises a usable public
    streamable-HTTP endpoint. Unusable records (wrong transport, missing URL)
    are logged and skipped.

    Returns:
        list[DiscoveredMcpServer]: Discovered, connectable servers. Empty when
        the feature is disabled, the registry is empty/unreachable, or no record
        exposes a supported endpoint.

    Raises:
        ValueError: If discovery is enabled but ``MCP_REGISTRY_ID`` is unset
            (propagated from :func:`_get_registry_id`).
    """
    if not is_discovery_enabled():
        return []

    registry_id = _get_registry_id()

    try:
        client = _registry_client()
        # Collect record ids from the paginated list API. Pages are not dense,
        # so iterate until no nextToken (the paginator handles that for us).
        record_ids: list[str] = []
        paginator = client.get_paginator("list_discoverable_registry_records")
        for page in paginator.paginate(
            registryId=registry_id,
            filters=[{"name": "recordType", "values": [_MCP_RECORD_TYPE]}],
        ):
            for record in page.get("registryRecords", []):
                record_id = record.get("recordId") or record.get("recordArn")
                if record_id:
                    record_ids.append(record_id)
    except Exception:
        # Fail soft: registry unreachable / access denied / throttled. The agent
        # continues with its built-in and gateway tools.
        logger.warning(
            "[MCP-REGISTRY] Failed to list registry records; skipping discovery",
            exc_info=True,
        )
        return []

    if not record_ids:
        logger.info(
            "[MCP-REGISTRY] No approved MCP records found in registry %s", registry_id
        )
        return []

    discovered: list[DiscoveredMcpServer] = []
    try:
        # batch_get accepts up to 100 record ids per entry; chunk defensively.
        for chunk_start in range(0, len(record_ids), 100):
            chunk = record_ids[chunk_start : chunk_start + 100]
            response = client.batch_get_discoverable_registry_record(
                entries=[{"registryId": registry_id, "recordIds": chunk}]
            )
            for record in response.get("registryRecords", []):
                server = _to_discovered_server(record)
                if server is not None:
                    discovered.append(server)
            for error in response.get("errors", []):
                logger.warning(
                    "[MCP-REGISTRY] Could not fetch record %s: %s",
                    error.get("recordId"),
                    error.get("errorCode"),
                )
    except Exception:
        logger.warning(
            "[MCP-REGISTRY] Failed to batch-get record descriptors; skipping discovery",
            exc_info=True,
        )
        return []

    logger.info(
        "[MCP-REGISTRY] Discovered %d connectable MCP server(s)", len(discovered)
    )
    return discovered


def _to_discovered_server(record: dict) -> DiscoveredMcpServer | None:
    """Convert a full registry record into a connectable server, or skip it.

    Args:
        record: A full record object (including ``descriptor``) from
            ``batch_get_discoverable_registry_record``.

    Returns:
        DiscoveredMcpServer | None: The server when it exposes a public
        streamable-HTTP endpoint; None (with a logged reason) otherwise.
    """
    record_id = record.get("recordId") or record.get("recordArn") or "<unknown>"
    name = record.get("displayName") or record.get("name") or record_id

    url, transport = _extract_endpoint(record)
    if not url:
        logger.warning(
            "[MCP-REGISTRY] Record %s has no remote endpoint URL; skipping", record_id
        )
        return None

    # v1 only auto-connects public streamable-HTTP servers. Transport may be
    # absent in some descriptors; treat absent as the supported default since
    # remote HTTP MCP is the registry's primary transport.
    if transport is not None and transport != _SUPPORTED_TRANSPORT:
        logger.warning(
            "[MCP-REGISTRY] Record %s uses unsupported transport '%s'; skipping (only %s is auto-connected)",
            record_id,
            transport,
            _SUPPORTED_TRANSPORT,
        )
        return None

    return DiscoveredMcpServer(
        record_id=record_id,
        name=name,
        url=url,
        transport=transport or _SUPPORTED_TRANSPORT,
    )


def build_registry_mcp_clients() -> list[MCPClient]:
    """Build live Strands MCP clients for every discovered registry server.

    Each returned client can be dropped directly into a Strands ``Agent``'s
    ``tools=[...]`` list (a ``MCPClient`` is a tool provider), exactly like the
    gateway client in :mod:`tools.gateway`. The streamable-HTTP connection is
    created lazily inside the client's factory lambda so a fresh transport is
    established on each (re)connection.

    Returns:
        list[MCPClient]: One client per connectable discovered server. Empty
        when discovery is disabled or nothing connectable was found.

    Raises:
        ValueError: If discovery is enabled but ``MCP_REGISTRY_ID`` is unset.
    """
    servers = discover_registry_mcp_servers()

    clients: list[MCPClient] = []
    used_prefixes: set[str] = set()
    for server in servers:
        # De-duplicate prefixes: two records whose names slugify identically would
        # otherwise produce colliding tool-name namespaces. Suffix -2, -3, ... on
        # collision so each connected server keeps a distinct prefix.
        base_prefix = _safe_prefix(server.name)
        prefix = base_prefix
        n = 2
        while prefix in used_prefixes:
            prefix = f"{base_prefix}_{n}"
            n += 1
        used_prefixes.add(prefix)

        # Bind the URL per-iteration via a default arg so every lambda captures
        # its own endpoint (avoids the classic late-binding closure bug).
        clients.append(
            MCPClient(
                lambda url=server.url: streamablehttp_client(url=url),
                prefix=prefix,
            )
        )
        logger.info(
            "[MCP-REGISTRY] Connected MCP server '%s' at %s", server.name, server.url
        )

    return clients
