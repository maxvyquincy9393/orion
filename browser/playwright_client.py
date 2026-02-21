"""
playwright_client.py

Playwright headless browser client for Orion.
Provides navigation, screenshots, content extraction, and link extraction.
All actions pass through sandbox permission check.
Part of Orion — Persistent AI Companion System.
"""

import asyncio
import logging
from typing import Optional

import config

_log = logging.getLogger("orion.browser")
_log_file = config.LOGS_DIR / "browser.log"
_handler = logging.FileHandler(_log_file)
_handler.setFormatter(logging.Formatter("%(asctime)s | %(levelname)-8s | %(message)s"))
_log.addHandler(_handler)
_log.setLevel(getattr(logging, config.LOG_LEVEL, logging.INFO))


class PlaywrightClient:
    """
    Playwright headless browser client.

    Provides async context manager support for resource management.
    All navigation actions check sandbox permission first.

    Example:
        async with PlaywrightClient() as client:
            text = await client.navigate("https://example.com")
            screenshot = await client.screenshot("https://example.com")
    """

    def __init__(self, headless: bool = True):
        """
        Initialize the Playwright client.

        Args:
            headless: Run browser in headless mode. Defaults to True.
        """
        self.headless = headless
        self._playwright = None
        self._browser = None
        self._context = None
        self._page = None

    async def __aenter__(self) -> "PlaywrightClient":
        """Start browser on context entry."""
        await self._start()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        """Close browser on context exit."""
        await self._close()

    async def _start(self) -> None:
        """Initialize Playwright and start browser."""
        try:
            from playwright.async_api import async_playwright

            self._playwright = await async_playwright().start()
            self._browser = await self._playwright.chromium.launch(
                headless=self.headless
            )
            self._context = await self._browser.new_context(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            )
            self._page = await self._context.new_page()
            _log.info("PLAYWRIGHT | Browser started (headless=%s)", self.headless)

        except ImportError:
            _log.error(
                "PLAYWRIGHT | playwright not installed. Run: pip install playwright && playwright install"
            )
            raise
        except Exception as exc:
            _log.error("PLAYWRIGHT | Failed to start browser: %s", exc)
            raise

    async def _close(self) -> None:
        """Close browser and Playwright."""
        try:
            if self._page:
                await self._page.close()
            if self._context:
                await self._context.close()
            if self._browser:
                await self._browser.close()
            if self._playwright:
                await self._playwright.stop()
            _log.info("PLAYWRIGHT | Browser closed")
        except Exception:
            pass

    def _check_permission(self, url: str) -> bool:
        """
        Check sandbox permission for browser navigation.

        Args:
            url: The URL to navigate to.

        Returns:
            True if allowed, False otherwise.
        """
        try:
            from permissions.permission_types import PermissionAction
            from permissions import sandbox

            result = sandbox.check(
                PermissionAction.BROWSER_NAVIGATE.value, {"url": url}
            )

            if not result.allowed:
                _log.warning("PLAYWRIGHT | Navigation blocked: %s", result.reason)
                return False

            if result.requires_confirm:
                confirmed = sandbox.request_confirm(
                    PermissionAction.BROWSER_NAVIGATE.value,
                    {"url": url},
                )
                if not confirmed:
                    _log.info("PLAYWRIGHT | User denied navigation to %s", url)
                    return False

            return True

        except Exception as exc:
            _log.error("PLAYWRIGHT | Permission check failed: %s", exc)
            return True

    async def navigate(self, url: str) -> str:
        """
        Navigate to URL and return page text content.

        Args:
            url: The URL to navigate to.

        Returns:
            The text content of the page, or error message.

        Example:
            text = await client.navigate("https://example.com")
        """
        if not self._check_permission(url):
            return "[Permission denied]"

        if not self._page:
            await self._start()

        try:
            _log.info("PLAYWRIGHT NAVIGATE | url=%s", url)
            await self._page.goto(url, wait_until="networkidle", timeout=30000)

            text = await self._page.content()

            from bs4 import BeautifulSoup

            soup = BeautifulSoup(text, "html.parser")

            for element in soup(
                ["script", "style", "nav", "header", "footer", "aside"]
            ):
                element.decompose()

            text = soup.get_text(separator="\n", strip=True)

            lines = [line.strip() for line in text.split("\n") if line.strip()]
            clean_text = "\n".join(lines)

            _log.info(
                "PLAYWRIGHT NAVIGATE | url=%s | content_len=%d", url, len(clean_text)
            )
            return clean_text

        except Exception as exc:
            _log.error("PLAYWRIGHT NAVIGATE | url=%s | error: %s", url, exc)
            return f"[Error] Failed to navigate: {exc}"

    async def screenshot(self, url: str, full_page: bool = False) -> bytes:
        """
        Take a screenshot of the page.

        Args:
            url: The URL to screenshot.
            full_page: Capture full page or viewport. Defaults to False.

        Returns:
            PNG screenshot as bytes, or empty bytes on error.

        Example:
            png_data = await client.screenshot("https://example.com")
        """
        if not self._check_permission(url):
            return b""

        if not self._page:
            await self._start()

        try:
            _log.info("PLAYWRIGHT SCREENSHOT | url=%s", url)
            await self._page.goto(url, wait_until="networkidle", timeout=30000)

            screenshot_bytes = await self._page.screenshot(full_page=full_page)

            _log.info(
                "PLAYWRIGHT SCREENSHOT | url=%s | size=%d bytes",
                url,
                len(screenshot_bytes),
            )
            return screenshot_bytes

        except Exception as exc:
            _log.error("PLAYWRIGHT SCREENSHOT | url=%s | error: %s", url, exc)
            return b""

    async def extract_links(self, url: str) -> list[str]:
        """
        Extract all href links from a page.

        Args:
            url: The URL to extract links from.

        Returns:
            List of href URLs.

        Example:
            links = await client.extract_links("https://example.com")
        """
        if not self._check_permission(url):
            return []

        if not self._page:
            await self._start()

        try:
            _log.info("PLAYWRIGHT LINKS | url=%s", url)
            await self._page.goto(url, wait_until="networkidle", timeout=30000)

            links = await self._page.eval_on_selector_all(
                "a[href]", "els => els.map(el => el.href)"
            )

            unique_links = list(set(links))

            _log.info("PLAYWRIGHT LINKS | url=%s | count=%d", url, len(unique_links))
            return unique_links

        except Exception as exc:
            _log.error("PLAYWRIGHT LINKS | url=%s | error: %s", url, exc)
            return []

    async def extract_content(self, url: str, selector: Optional[str] = None) -> str:
        """
        Extract text content from a page, optionally scoped to a CSS selector.

        Args:
            url: The URL to extract content from.
            selector: Optional CSS selector to scope extraction.

        Returns:
            Extracted text content.

        Example:
            text = await client.extract_content("https://example.com", "article.content")
        """
        if not self._check_permission(url):
            return "[Permission denied]"

        if not self._page:
            await self._start()

        try:
            _log.info("PLAYWRIGHT EXTRACT | url=%s | selector=%s", url, selector)
            await self._page.goto(url, wait_until="networkidle", timeout=30000)

            if selector:
                element = await self._page.query_selector(selector)
                if element:
                    text = await element.inner_text()
                else:
                    text = f"[Selector '{selector}' not found]"
            else:
                text = await self._page.inner_text("body")

            _log.info("PLAYWRIGHT EXTRACT | url=%s | content_len=%d", url, len(text))
            return text

        except Exception as exc:
            _log.error("PLAYWRIGHT EXTRACT | url=%s | error: %s", url, exc)
            return f"[Error] Failed to extract: {exc}"

    async def click(self, selector: str) -> bool:
        """
        Click an element on the current page.

        Args:
            selector: CSS selector for element to click.

        Returns:
            True if click succeeded, False otherwise.

        Example:
            await client.click("button.submit")
        """
        if not self._page:
            return False

        try:
            await self._page.click(selector, timeout=5000)
            _log.info("PLAYWRIGHT CLICK | selector=%s", selector)
            return True
        except Exception as exc:
            _log.error("PLAYWRIGHT CLICK | selector=%s | error: %s", selector, exc)
            return False

    async def fill(self, selector: str, value: str) -> bool:
        """
        Fill a form field on the current page.

        Args:
            selector: CSS selector for input field.
            value: Value to fill.

        Returns:
            True if fill succeeded, False otherwise.

        Example:
            await client.fill("input[name='q']", "search query")
        """
        if not self._page:
            return False

        try:
            await self._page.fill(selector, value, timeout=5000)
            _log.info(
                "PLAYWRIGHT FILL | selector=%s | value_len=%d", selector, len(value)
            )
            return True
        except Exception as exc:
            _log.error("PLAYWRIGHT FILL | selector=%s | error: %s", selector, exc)
            return False

    async def wait_for_selector(self, selector: str, timeout: int = 10000) -> bool:
        """
        Wait for a selector to appear on the page.

        Args:
            selector: CSS selector to wait for.
            timeout: Max wait time in ms.

        Returns:
            True if selector appeared, False on timeout.

        Example:
            await client.wait_for_selector("div.results", timeout=5000)
        """
        if not self._page:
            return False

        try:
            await self._page.wait_for_selector(selector, timeout=timeout)
            return True
        except Exception:
            return False


def navigate_sync(url: str) -> str:
    """
    Synchronous wrapper for navigate.

    Args:
        url: URL to navigate to.

    Returns:
        Page text content.

    Example:
        text = navigate_sync("https://example.com")
    """

    async def _navigate():
        async with PlaywrightClient() as client:
            return await client.navigate(url)

    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            import concurrent.futures

            with concurrent.futures.ThreadPoolExecutor() as pool:
                future = pool.submit(asyncio.run, _navigate())
                return future.result()
        else:
            return loop.run_until_complete(_navigate())
    except RuntimeError:
        return asyncio.run(_navigate())


def screenshot_sync(url: str) -> bytes:
    """
    Synchronous wrapper for screenshot.

    Args:
        url: URL to screenshot.

    Returns:
        PNG bytes.

    Example:
        png = screenshot_sync("https://example.com")
    """

    async def _screenshot():
        async with PlaywrightClient() as client:
            return await client.screenshot(url)

    try:
        return asyncio.run(_screenshot())
    except RuntimeError:
        loop = asyncio.new_event_loop()
        result = loop.run_until_complete(_screenshot())
        loop.close()
        return result
