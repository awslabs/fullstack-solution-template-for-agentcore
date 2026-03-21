# tests/unit/conftest.py
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

import sys
from pathlib import Path
import pytest

_agent_path = str(Path(__file__).parent.parent.parent / "patterns" / "langgraph-single-agent")


@pytest.fixture(autouse=True, scope="session")
def _prioritise_agent_tools():
    """Ensure the langgraph agent's tools package is first on sys.path.

    pytest inserts the repo root into sys.path[0] during collection, which
    causes Python to resolve `tools` to the top-level tools/ package rather
    than patterns/langgraph-single-agent/tools/.  This session-scoped fixture
    re-inserts the agent path at position 0 and evicts any cached entry so
    that all unit tests in this directory pick up the correct package.
    """
    while _agent_path in sys.path:
        sys.path.remove(_agent_path)
    sys.path.insert(0, _agent_path)
    sys.modules.pop("tools", None)
    yield
