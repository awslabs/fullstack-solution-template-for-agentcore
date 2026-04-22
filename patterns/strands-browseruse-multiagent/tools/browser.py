"""Strands browser tool — browser-use + Claude + AgentCore Browser.

Streams the live view URL as a tool_stream_event so the frontend can show
a 'Watch live' link while the browser is running.

Session is reused across tool calls (same pattern as Code Interpreter).
Delegates session management to the shared BrowserTools core.

The browser-use Browser instance is kept alive across calls so that
browser-use preserves its internal state (agent memory, page context,
action history) between tasks — following the browser-use recommended
pattern for chained/follow-up tasks.
"""

import logging
import os
from typing import Any, AsyncGenerator, Dict, Optional

from agentcore_tools.browser.browser_tools import BrowserTools
from strands import tool

logger = logging.getLogger(__name__)

REGION = os.environ.get("AWS_DEFAULT_REGION", "us-east-1")
MODEL = os.environ.get(
    "BROWSER_USE_MODEL", "us.anthropic.claude-sonnet-4-5-20250929-v1:0"
)


class StrandsBrowserTools:
    """Strands wrapper for AgentCore Browser using browser-use + Claude.

    Uses the shared BrowserTools core for session lifecycle, same way
    StrandsCodeInterpreterTools delegates to CodeInterpreterTools.

    The browser-use Browser instance is kept alive across tool calls
    so that agent memory, page context, and action history persist
    between tasks (browser-use recommended pattern).
    """

    def __init__(self, region: str = REGION):
        self.core_tools = BrowserTools(region)
        self._browser_session: Optional[Any] = None
        self._agent: Optional[Any] = None
        self._llm: Optional[Any] = None

    async def _get_browser_session(self):
        """Get or create the browser-use Browser instance (kept alive across calls)."""
        if self._browser_session is None:
            from browser_use import Browser, BrowserProfile

            ws_url, headers = self.core_tools.start_session()
            browser_profile = BrowserProfile(
                headers=headers, window_size={"width": 1380, "height": 720}
            )
            self._browser_session = Browser(
                cdp_url=ws_url, browser_profile=browser_profile
            )
            await self._browser_session.start()
            logger.info("Started browser-use session (kept alive for reuse)")
        return self._browser_session

    def _get_llm(self):
        """Get or create the LLM instance (reused across calls)."""
        if self._llm is None:
            from browser_use.llm import ChatAnthropicBedrock

            self._llm = ChatAnthropicBedrock(
                model=MODEL, aws_region=self.core_tools.region
            )
        return self._llm

    async def cleanup(self):
        """Stop browser-use session and AgentCore browser session."""
        if self._browser_session:
            try:
                await self._browser_session.kill()
                logger.info("browser-use session killed")
            except Exception:
                pass
            self._browser_session = None
        self._agent = None
        self._llm = None
        self.core_tools.cleanup()

    @property
    def browser(self):
        tool_self = self

        @tool
        async def browser(
            task: str, starting_url: str
        ) -> AsyncGenerator[Dict[str, Any], None]:
            """
            Delegate a browser automation task to a browser-use sub-agent that
            autonomously controls a real browser (clicks, types, scrolls, navigates).

            IMPORTANT — how to write a good task:
            - Send the COMPLETE task with ALL steps in a single call. The sub-agent
              handles multi-step workflows on its own.
            - Be specific: state the goal, what to extract, and the desired output format.
            - Include context: URLs, search terms, criteria, credentials context.
            - Add fallbacks: what to do if the primary approach fails.
            - Set constraints: max results, date ranges, scope limits.

            Good task example:
              task: "Search for 'wireless headphones under $50', extract the name,
                     price, and star rating of the top 3 results. If fewer than 3
                     results match, include the closest alternatives."
              starting_url: "https://www.amazon.com"

            Bad task example:
              task: "Search for headphones"  (too vague — no output format, no criteria)

            DO NOT:
            - Give low-level UI instructions like "click the search button" or
              "type in the text field". The sub-agent figures out UI interactions.
            - Split a single workflow into multiple calls unless you need to process
              intermediate results yourself before the next step.

            The browser session persists across calls — cookies, login state, and open
            tabs carry over. Use multiple calls when you need to reason about
            intermediate results between steps.

            Args:
                task: Complete, detailed description of what to accomplish, including
                      all steps, expected output format, and fallback instructions.
                starting_url: URL to navigate to before starting the task.

            Yields:
                Intermediate events (e.g. live_view_url) while the task runs.

            Returns:
                Final dict with status, response, and live_view_url.
            """
            from browser_use import Agent as BrowserAgent

            try:
                browser_session = await tool_self._get_browser_session()
                live_view_url = tool_self.core_tools.get_live_view_url()

                # Yield the live view URL so the frontend can show a link
                yield {"type": "browser_live_view", "live_view_url": live_view_url}

                llm = tool_self._get_llm()
                full_task = f"Start at {starting_url}. {task}"

                if tool_self._agent is None:
                    # First call — create the agent
                    tool_self._agent = BrowserAgent(
                        task=full_task,
                        llm=llm,
                        browser_session=browser_session,
                    )
                else:
                    # Subsequent calls — chain task, preserving agent memory
                    tool_self._agent.add_new_task(full_task)

                # Use asyncio.Queue for immediate streaming — hooks put
                # each step into the queue, and the generator yields from
                # the queue without polling delay.
                import asyncio

                step_queue: asyncio.Queue = asyncio.Queue()
                step_count_tracker = {"count": 0}

                async def on_step_start_hook(agent):
                    """Called BEFORE each step — yields a 'thinking' event."""
                    step_num = step_count_tracker["count"] + 1

                    # Get current URL if available
                    current_url = ""
                    if hasattr(agent, "history") and agent.history:
                        urls = agent.history.urls()
                        if urls:
                            current_url = urls[-1] or ""

                    await step_queue.put(
                        {
                            "type": "browser_action",
                            "extracted_content": f"Step {step_num}: Thinking..."
                            + (f" (on {current_url})" if current_url else ""),
                            "step": step_num,
                            "phase": "start",
                        }
                    )

                async def on_step_end_hook(agent):
                    """Called AFTER each step — yields the completed action."""
                    if not hasattr(agent, "history") or not agent.history:
                        return

                    new_count = agent.history.number_of_steps()
                    old_count = step_count_tracker["count"]
                    if new_count <= old_count:
                        return

                    action_names = agent.history.action_names()
                    extracted = agent.history.extracted_content()
                    urls = agent.history.urls()

                    for i in range(old_count, new_count):
                        parts = []
                        if i < len(action_names):
                            parts.append(action_names[i])
                        if i < len(urls) and urls[i]:
                            parts.append(f"@ {urls[i]}")
                        if i < len(extracted) and extracted[i]:
                            parts.append(f"→ {extracted[i]}")

                        summary = (
                            " ".join(parts) if parts else f"Step {i + 1} completed"
                        )
                        await step_queue.put(
                            {
                                "type": "browser_action",
                                "extracted_content": summary,
                                "step": i + 1,
                                "phase": "end",
                            }
                        )

                    step_count_tracker["count"] = new_count

                # Run the agent with both hooks in a background task
                agent_task = asyncio.create_task(
                    tool_self._agent.run(
                        on_step_start=on_step_start_hook,
                        on_step_end=on_step_end_hook,
                    )
                )

                # Yield steps from the queue as they arrive
                while not agent_task.done():
                    try:
                        step = await asyncio.wait_for(step_queue.get(), timeout=0.5)
                        yield step
                    except asyncio.TimeoutError:
                        continue

                # Get the final result (may raise if agent failed)
                result = await agent_task

                # Drain any remaining steps from the queue
                while not step_queue.empty():
                    yield step_queue.get_nowait()

                yield {
                    "status": "success",
                    "response": str(result),
                    "live_view_url": live_view_url,
                }

            except Exception as e:
                logger.exception("Browser task failed")
                yield {
                    "status": "error",
                    "error": str(e),
                    "live_view_url": tool_self.core_tools.get_live_view_url(),
                }

        return browser
