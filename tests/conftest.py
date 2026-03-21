# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
"""
Pytest configuration file for the FAST tests.
"""

import sys
from pathlib import Path

# Allow tests to import directly from the langgraph agent's tools package.
# The directory name contains a hyphen and cannot be used as a Python import name,
# so we add it to sys.path and import from tools.* directly.
_agent_path = str(Path(__file__).parent.parent / "patterns" / "langgraph-single-agent")
sys.path.insert(0, _agent_path)
# Evict any previously cached 'tools' entry so the path-priority change takes effect.
sys.modules.pop("tools", None)


def pytest_configure(config):
    """Re-insert the agent path at position 0 after pytest has finished its own
    sys.path manipulation, then evict any stale 'tools' cache entry so that
    imports resolve to the langgraph agent's tools package rather than the
    top-level tools/ directory in the repo root."""
    while _agent_path in sys.path:
        sys.path.remove(_agent_path)
    sys.path.insert(0, _agent_path)
    sys.modules.pop("tools", None)
