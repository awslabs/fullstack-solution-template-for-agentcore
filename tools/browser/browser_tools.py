"""Core Browser tools for AgentCore — generic session management and capabilities.

Framework-agnostic. No Strands, no browser-use, no Nova Act.
Pattern-specific wrappers (e.g. patterns/strands-browseruse-multiagent/tools/browser.py)
use this class for session lifecycle and layer their automation library on top.

Follows the same lazy-init + reuse pattern as CodeInterpreterTools.
"""

import base64
import logging
from typing import Any, Dict, Optional, Tuple

logger = logging.getLogger(__name__)


class BrowserTools:
    """
    AgentCore Browser session manager.

    Responsibilities:
      - Start / stop a single browser session (reused across calls)
      - Expose CDP connection details (ws_url, headers) for any automation library
      - Generate presigned live view URL for DCV streaming
      - Human take-over / release
      - OS-level actions (screenshot, mouse, keyboard) via InvokeBrowser API
    """

    def __init__(self, region: str):
        self.region = region
        self._client = None
        self._runtime_client = None

    # ── Session Lifecycle ────────────────────────────────────────────────────

    def _get_client(
        self,
        browser_id: Optional[str] = None,
        session_timeout_seconds: int = 3600,
        viewport: Optional[Dict[str, int]] = None,
    ):
        """Lazy-create the BrowserClient. Reused on subsequent calls."""
        if self._client is None:
            from bedrock_agentcore.tools.browser_client import BrowserClient

            self._client = BrowserClient(region=self.region)
            kwargs: Dict[str, Any] = {
                "session_timeout_seconds": session_timeout_seconds,
                "viewport": viewport,
            }
            if browser_id:
                kwargs["identifier"] = browser_id
            self._client.start(**{k: v for k, v in kwargs.items() if v is not None})
            logger.info(f"Started browser session in {self.region}")
        return self._client

    def start_session(
        self,
        browser_id: Optional[str] = None,
        session_timeout_seconds: int = 3600,
        viewport: Optional[Dict[str, int]] = None,
    ) -> Tuple[str, Dict[str, str]]:
        """Start (or reuse) a session and return CDP (ws_url, headers)."""
        client = self._get_client(browser_id, session_timeout_seconds, viewport)
        return client.generate_ws_headers()

    def cleanup(self):
        """Stop the browser session. AgentCore also auto-cleans after timeout."""
        if self._client:
            try:
                self._client.stop()
                logger.info("Browser session stopped")
            except Exception as e:
                logger.warning(f"Error stopping browser session: {e}")
            finally:
                self._client = None

    @property
    def browser_id(self) -> Optional[str]:
        return self._client.identifier if self._client else None

    @property
    def session_id(self) -> Optional[str]:
        return self._client.session_id if self._client else None

    # ── Live View ────────────────────────────────────────────────────────────

    def get_live_view_url(self, expires: int = 300) -> Optional[str]:
        """Presigned DCV live view URL, or None if no active session."""
        if not self._client:
            return None
        return self._client.generate_live_view_url(expires=expires)

    # ── Human Take-Over ──────────────────────────────────────────────────────

    def take_control(self):
        """Pause agent automation so a human can take over via live view."""
        if self._client:
            self._client.take_control()
            logger.info("Human took control of browser")

    def release_control(self):
        """Resume agent automation after human take-over."""
        if self._client:
            self._client.release_control()
            logger.info("Agent resumed control of browser")

    # ── OS-Level Actions ─────────────────────────────────────────────────────

    def _get_runtime_client(self):
        if not self._runtime_client:
            import boto3

            self._runtime_client = boto3.client(
                "bedrock-agentcore", region_name=self.region
            )
        return self._runtime_client

    def _invoke(self, action: Dict[str, Any]) -> Dict[str, Any]:
        if not self._client:
            raise RuntimeError("No active browser session. Call start_session() first.")
        client = self._get_runtime_client()
        response = client.invoke_browser(
            browserIdentifier=self._client.identifier,
            sessionId=self._client.session_id,
            action=action,
        )
        return response.get("result", {})

    def screenshot(self, format: str = "PNG") -> bytes:
        """Take a screenshot. Returns raw bytes."""
        result = self._invoke({"screenshot": {"format": format}})
        img_data = result.get("screenshot", {}).get("data", b"")
        if isinstance(img_data, str):
            return base64.b64decode(img_data)
        return img_data

    def screenshot_base64(self, format: str = "PNG") -> str:
        """Screenshot as base64 string (for sending to LLMs)."""
        return base64.b64encode(self.screenshot(format=format)).decode()

    def mouse_click(self, x: int, y: int, button: str = "LEFT", click_count: int = 1):
        self._invoke(
            {
                "mouseClick": {
                    "x": x,
                    "y": y,
                    "button": button,
                    "clickCount": click_count,
                }
            }
        )

    def mouse_move(self, x: int, y: int):
        self._invoke({"mouseMove": {"x": x, "y": y}})

    def mouse_drag(
        self, start_x: int, start_y: int, end_x: int, end_y: int, button: str = "LEFT"
    ):
        self._invoke(
            {
                "mouseDrag": {
                    "startX": start_x,
                    "startY": start_y,
                    "endX": end_x,
                    "endY": end_y,
                    "button": button,
                }
            }
        )

    def scroll(self, x: int, y: int, delta_x: int = 0, delta_y: int = -300):
        self._invoke(
            {"mouseScroll": {"x": x, "y": y, "deltaX": delta_x, "deltaY": delta_y}}
        )

    def type_text(self, text: str):
        self._invoke({"keyType": {"text": text}})

    def key_press(self, key: str, presses: int = 1):
        self._invoke({"keyPress": {"key": key, "presses": presses}})

    def key_shortcut(self, *keys: str):
        self._invoke({"keyShortcut": {"keys": list(keys)}})
