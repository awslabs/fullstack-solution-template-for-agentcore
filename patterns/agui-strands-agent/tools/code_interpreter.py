"""Strands-specific wrapper for Code Interpreter."""

from agentcore_tools.code_interpreter.code_interpreter_tools import CodeInterpreterTools
from strands import tool


class StrandsCodeInterpreterTools:
    """Strands wrapper for Code Interpreter tools."""

    def __init__(self, region: str):
        self.core_tools = CodeInterpreterTools(region)

    def cleanup(self):
        """Clean up code interpreter session."""
        self.core_tools.cleanup()

    @tool
    def execute_python_securely(self, code: str) -> str:
        """Execute Python code in a secure AgentCore CodeInterpreter sandbox.

        Args:
            code: Python code to execute

        Returns:
            JSON string with execution result
        """
        return self.core_tools.execute_python_securely(code)
