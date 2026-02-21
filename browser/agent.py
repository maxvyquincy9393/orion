"""
agent.py

Autonomous browsing agent for Orion.
Uses browser-use and Playwright for web navigation, search, and content extraction.
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


class BrowserAgent:
    """
    Autonomous browsing agent using Playwright.

    Provides high-level operations like search and summarize, research,
    and goal-oriented navigation.

    Example:
        agent = BrowserAgent()
        summary = agent.search_and_summarize("Python async tutorial")
        research = agent.research("quantum computing basics", depth=2)
    """

    def __init__(self):
        """Initialize the BrowserAgent."""
        self._client = None

    def _check_permission(self, action: str, details: dict) -> bool:
        """
        Check sandbox permission for browser action.

        Args:
            action: The action string.
            details: Action details dict.

        Returns:
            True if allowed, False otherwise.
        """
        try:
            from permissions.permission_types import PermissionAction
            from permissions import sandbox

            permission_action = getattr(PermissionAction, action, None)
            if permission_action is None:
                permission_action = PermissionAction.BROWSER_NAVIGATE

            result = sandbox.check(permission_action.value, details)

            if not result.allowed:
                _log.warning("BROWSER AGENT | Action blocked: %s", result.reason)
                return False

            if result.requires_confirm:
                confirmed = sandbox.request_confirm(permission_action.value, details)
                if not confirmed:
                    _log.info("BROWSER AGENT | User denied action: %s", action)
                    return False

            return True

        except Exception as exc:
            _log.error("BROWSER AGENT | Permission check failed: %s", exc)
            return True

    def search_and_summarize(self, query: str, top_n: int = 3) -> str:
        """
        Search the web, visit top results, and summarize content.

        Args:
            query: The search query.
            top_n: Number of top results to visit. Defaults to 3.

        Returns:
            A synthesized summary of the content.

        Example:
            summary = agent.search_and_summarize("best Python practices")
        """
        if not self._check_permission("BROWSER_NAVIGATE", {"query": query}):
            return "[Permission denied for search]"

        _log.info("BROWSER AGENT | search_and_summarize | query='%s'", query[:50])

        from browser.search import search

        results = search(query, max_results=top_n)

        if not results:
            return f"No results found for: {query}"

        contents = []

        async def fetch_content():
            from browser.playwright_client import PlaywrightClient

            async with PlaywrightClient() as client:
                for i, result in enumerate(results[:top_n]):
                    url = result.get("url", "")
                    title = result.get("title", "")

                    if not self._check_permission("BROWSER_NAVIGATE", {"url": url}):
                        continue

                    try:
                        content = await client.extract_content(url)
                        contents.append(
                            {
                                "title": title,
                                "url": url,
                                "content": content[:2000],
                            }
                        )
                        _log.info("BROWSER AGENT | Fetched content from: %s", url)
                    except Exception as exc:
                        _log.warning("BROWSER AGENT | Failed to fetch %s: %s", url, exc)

        try:
            asyncio.run(fetch_content())
        except RuntimeError:
            loop = asyncio.new_event_loop()
            loop.run_until_complete(fetch_content())
            loop.close()

        if not contents:
            return f"Could not fetch content from search results for: {query}"

        summary_prompt = self._build_summary_prompt(query, contents)

        try:
            from core.orchestrator import route

            engine = route("reasoning")
            summary = engine.generate(summary_prompt, [])

            _log.info(
                "BROWSER AGENT | search_and_summarize complete | query='%s'", query[:50]
            )
            return summary

        except Exception as exc:
            _log.error("BROWSER AGENT | Summarization failed: %s", exc)
            return self._fallback_summary(contents)

    def research(self, topic: str, depth: int = 2) -> str:
        """
        Multi-level research on a topic.

        Level 1: Search and visit top results.
        Level 2: Extract links from results, visit linked pages.
        Level 3+: Recursively explore (if depth > 2).

        Args:
            topic: The research topic.
            depth: Research depth level. Defaults to 2.

        Returns:
            Synthesized research summary.

        Example:
            research = agent.research("machine learning fundamentals", depth=2)
        """
        if not self._check_permission("BROWSER_NAVIGATE", {"topic": topic}):
            return "[Permission denied for research]"

        _log.info("BROWSER AGENT | research | topic='%s' | depth=%d", topic[:50], depth)

        from browser.search import search

        results = search(topic, max_results=5)

        all_content = []

        async def fetch_all():
            from browser.playwright_client import PlaywrightClient

            async with PlaywrightClient() as client:
                for result in results[: depth + 1]:
                    url = result.get("url", "")
                    title = result.get("title", "")

                    if not self._check_permission("BROWSER_NAVIGATE", {"url": url}):
                        continue

                    try:
                        content = await client.extract_content(url)
                        all_content.append(
                            {
                                "title": title,
                                "url": url,
                                "content": content[:2000],
                                "level": 1,
                            }
                        )

                        if depth >= 2:
                            links = await client.extract_links(url)
                            for link in links[:depth]:
                                if not self._check_permission(
                                    "BROWSER_NAVIGATE", {"url": link}
                                ):
                                    continue

                                try:
                                    link_content = await client.extract_content(link)
                                    all_content.append(
                                        {
                                            "title": f"Linked from: {title}",
                                            "url": link,
                                            "content": link_content[:1500],
                                            "level": 2,
                                        }
                                    )
                                except Exception:
                                    pass

                    except Exception as exc:
                        _log.warning("BROWSER AGENT | Research fetch error: %s", exc)

        try:
            asyncio.run(fetch_all())
        except RuntimeError:
            loop = asyncio.new_event_loop()
            loop.run_until_complete(fetch_all())
            loop.close()

        if not all_content:
            return f"No content found for research topic: {topic}"

        research_prompt = self._build_research_prompt(topic, all_content)

        try:
            from core.orchestrator import route

            engine = route("reasoning")
            summary = engine.generate(research_prompt, [])

            _log.info("BROWSER AGENT | research complete | topic='%s'", topic[:50])
            return summary

        except Exception as exc:
            _log.error("BROWSER AGENT | Research summarization failed: %s", exc)
            return self._fallback_summary(all_content)

    def navigate_and_extract(self, url: str, goal: str) -> str:
        """
        Navigate to URL and extract info relevant to goal.

        Args:
            url: The URL to navigate to.
            goal: What information to extract.

        Returns:
            Extracted information relevant to goal.

        Example:
            info = agent.navigate_and_extract("https://docs.python.org", "async await syntax")
        """
        if not self._check_permission("BROWSER_NAVIGATE", {"url": url}):
            return "[Permission denied for navigation]"

        _log.info(
            "BROWSER AGENT | navigate_and_extract | url=%s | goal='%s'", url, goal[:50]
        )

        async def fetch_and_extract():
            from browser.playwright_client import PlaywrightClient

            async with PlaywrightClient() as client:
                content = await client.extract_content(url)
                return content

        try:
            content = asyncio.run(fetch_and_extract())
        except RuntimeError:
            loop = asyncio.new_event_loop()
            content = loop.run_until_complete(fetch_and_extract())
            loop.close()

        if not content or content.startswith("[Error]"):
            return f"Could not extract content from {url}"

        extraction_prompt = f"""Extract information from the following web page content that is relevant to this goal: "{goal}"

WEB PAGE CONTENT:
{content[:4000]}

Provide a concise extraction of the relevant information. If nothing relevant is found, say so.

EXTRACTION:"""

        try:
            from core.orchestrator import route

            engine = route("fast")
            extraction = engine.generate(extraction_prompt, [])

            _log.info("BROWSER AGENT | navigate_and_extract complete | url=%s", url)
            return extraction

        except Exception as exc:
            _log.error("BROWSER AGENT | Extraction failed: %s", exc)
            return f"Content from {url}:\n\n{content[:1000]}"

    def _build_summary_prompt(self, query: str, contents: list[dict]) -> str:
        """Build prompt for summary generation."""
        sources_text = ""
        for i, c in enumerate(contents, 1):
            sources_text += f"\n[SOURCE {i}: {c['title']}]\n{c['content']}\n"

        return f"""Summarize the following web content in response to this query: "{query}"

SOURCES:
{sources_text}

Provide a comprehensive summary that addresses the query. Include key points from each source.
Cite sources using [SOURCE X] notation where appropriate.

SUMMARY:"""

    def _build_research_prompt(self, topic: str, contents: list[dict]) -> str:
        """Build prompt for research synthesis."""
        sources_text = ""
        for i, c in enumerate(contents, 1):
            level_indicator = "(Level 2)" if c.get("level", 1) == 2 else ""
            sources_text += f"\n[SOURCE {i} {level_indicator}: {c['title']}]\nURL: {c['url']}\n{c['content']}\n"

        return f"""Synthesize a research summary on this topic: "{topic}"

SOURCES:
{sources_text}

Provide a comprehensive research synthesis that:
1. Identifies key themes and insights
2. Notes any contradictions or gaps
3. Provides actionable conclusions
Cite sources using [SOURCE X] notation.

RESEARCH SUMMARY:"""

    def _fallback_summary(self, contents: list[dict]) -> str:
        """Generate fallback summary without LLM."""
        lines = ["Summary of content from", ""]
        for c in contents:
            lines.append(f"** {c.get('title', 'Untitled')}")
            lines.append(f"   URL: {c.get('url', 'N/A')}")
            content_preview = c.get("content", "")[:300]
            lines.append(f"   Preview: {content_preview}...")
            lines.append("")
        return "\n".join(lines)


def search_and_browse(query: str) -> str:
    """
    Convenience function for quick search and browse.

    Args:
        query: The search query.

    Returns:
        Summary of search results.

    Example:
        summary = search_and_browse("Python async tutorial")
    """
    agent = BrowserAgent()
    return agent.search_and_summarize(query)


def extract_content(url: str) -> str:
    """
    Convenience function to extract content from URL.

    Args:
        url: The URL to extract from.

    Returns:
        Page content.

    Example:
        content = extract_content("https://example.com")
    """
    agent = BrowserAgent()
    return agent.navigate_and_extract(url, "extract all content")


def take_screenshot(url: str) -> bytes:
    """
    Convenience function to take screenshot.

    Args:
        url: The URL to screenshot.

    Returns:
        PNG bytes.

    Example:
        png = take_screenshot("https://example.com")
    """
    from browser.playwright_client import screenshot_sync

    return screenshot_sync(url)
