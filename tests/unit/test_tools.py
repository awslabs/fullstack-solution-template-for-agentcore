# tests/unit/test_tools.py
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
import pytest
from pathlib import Path


def test_query_data_returns_list():
    """query_data.invoke returns the cached CSV rows as a list of dicts."""
    from tools.query_data import query_data
    result = query_data.invoke({"query": "show all data"})
    assert isinstance(result, list)
    assert len(result) > 0
    assert isinstance(result[0], dict)


def test_query_data_rows_have_expected_columns():
    """Each CSV row has the required financial data columns."""
    from tools.query_data import query_data
    result = query_data.invoke({"query": "all"})
    row = result[0]
    for col in ("date", "category", "amount", "type"):
        assert col in row, f"Missing column: {col}"


def test_db_csv_exists():
    """db.csv must be present alongside query_data.py."""
    # Use an anchored path relative to this test file so the test is portable
    # regardless of the working directory pytest is invoked from.
    csv_path = Path(__file__).parent.parent.parent / "patterns" / "langgraph-single-agent" / "tools" / "db.csv"
    assert csv_path.exists(), f"db.csv must exist at {csv_path}"


def test_todo_typed_dict_has_required_fields():
    """Todo TypedDict must declare all required keys."""
    from tools.todos import Todo
    todo: Todo = {
        "id": "abc-123",
        "title": "Test task",
        "description": "A test todo",
        "emoji": "🎯",
        "status": "pending",
    }
    assert todo["id"] == "abc-123"
    assert todo["status"] == "pending"


def test_agent_state_declares_todos_annotation():
    """AgentState must extend BaseAgentState and annotate a 'todos' field."""
    from tools.todos import AgentState
    assert "todos" in AgentState.__annotations__


def test_assign_ids_fills_missing_ids():
    """_assign_ids assigns a non-empty uuid to any todo with a missing or empty id."""
    from tools.todos import _assign_ids
    todos = [
        {"id": "", "title": "x", "description": "", "emoji": "🎯", "status": "pending"},
        {"id": "existing-id", "title": "y", "description": "", "emoji": "🎯", "status": "pending"},
    ]
    result = _assign_ids(todos)
    assert result[0]["id"] != ""
    assert result[1]["id"] == "existing-id"  # existing IDs are preserved


def test_todo_tools_exported_with_correct_names():
    """todo_tools must be a list of exactly two tools: manage_todos and get_todos."""
    from tools.todos import todo_tools
    assert len(todo_tools) == 2
    names = {t.name for t in todo_tools}
    assert "manage_todos" in names
    assert "get_todos" in names
