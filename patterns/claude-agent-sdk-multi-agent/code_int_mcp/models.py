# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""Data models for Code Interpreter."""

from typing import Optional

from pydantic import BaseModel, Field


class CodeIntExecutionResult(BaseModel):
    """Result model for code execution."""

    output: str
    code_int_session_id: str
    execution_time: float = Field(..., ge=0, description="Execution time in seconds")
    success: bool
    error: Optional[str] = None
