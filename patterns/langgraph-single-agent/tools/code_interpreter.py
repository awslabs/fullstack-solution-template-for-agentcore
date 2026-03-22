"""LangGraph-specific wrapper for Code Interpreter."""

from agentcore_tools.code_interpreter.code_interpreter_tools import CodeInterpreterTools
from langchain_core.tools import tool


class LangGraphCodeInterpreterTools:
    """LangGraph wrapper for Code Interpreter tools."""

    def __init__(self, region: str):
        self.core_tools = CodeInterpreterTools(region)

    def cleanup(self):
        """Clean up code interpreter session."""
        self.core_tools.cleanup()

    @property
    def execute_python_securely(self):
        """Get the execute_python_securely tool function."""
        core = self.core_tools

        @tool
        def execute_python_securely(code: str) -> str:
            """Execute Python code in a secure AgentCore CodeInterpreter sandbox.

            Args:
                code: Python code to execute

            Returns:
                JSON string with execution result
            """
            return core.execute_python_securely(code)

        return execute_python_securely
