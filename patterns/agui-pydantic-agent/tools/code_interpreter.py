"""Pydantic AI-specific wrapper for Code Interpreter."""

from agentcore_tools.code_interpreter.code_interpreter_tools import CodeInterpreterTools
from pydantic_ai import Tool


class PydanticAICodeInterpreterTools:
    """Pydantic AI wrapper for Code Interpreter tools."""

    def __init__(self, region: str):
        self.core_tools = CodeInterpreterTools(region)

    def cleanup(self):
        """Clean up code interpreter session."""
        self.core_tools.cleanup()

    def execute_python_securely(self, code: str) -> str:
        """Execute Python code in a secure AgentCore CodeInterpreter sandbox.

        Args:
            code: Python code to execute

        Returns:
            JSON string with execution result
        """
        return self.core_tools.execute_python_securely(code)

    @property
    def tool(self) -> Tool:
        """The sandbox as a Pydantic AI tool, ready to pass to ``Agent(tools=[...])``."""
        return Tool(self.execute_python_securely, name="execute_python_securely")
