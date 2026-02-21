"""
search.py

Free search implementation for Orion.
Uses DuckDuckGo (no API key needed) as primary, with SearXNG fallback.
Part of Orion — Persistent AI Companion System.
"""

import logging
import re
import urllib.parse
from typing import Any, Optional

import requests

import config

_log = logging.getLogger("orion.browser")
_log_file = config.LOGS_DIR / "browser.log"
_handler = logging.FileHandler(_log_file)
_handler.setFormatter(logging.Formatter("%(asctime)s | %(levelname)-8s | %(message)s"))
_log.addHandler(_handler)
_log.setLevel(getattr(logging, config.LOG_LEVEL, logging.INFO))

DDG_HTML_URL = "https://html.duckduckgo.com/html/"
DDG_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"


def search(query: str, max_results: int = 5) -> list[dict]:
    """
    Search the web for results.

    Tries DuckDuckGo first, falls back to SearXNG if configured.

    Args:
        query: The search query string.
        max_results: Maximum number of results to return. Defaults to 5.

    Returns:
        A list of result dicts, each with title, url, snippet.

    Example:
        results = search("Python async tutorial", max_results=5)
        for r in results:
            print(r["title"], r["url"])
    """
    _log.info("SEARCH | query='%s' | max_results=%d", query[:50], max_results)

    results = _duckduckgo_search(query, max_results)

    if not results and config.SEARXNG_URL:
        _log.info("SEARCH | DDG failed, trying SearXNG fallback")
        results = _searxng_search(query, max_results)

    _log.info("SEARCH COMPLETE | query='%s' | results=%d", query[:50], len(results))
    return results


def _duckduckgo_search(query: str, max_results: int) -> list[dict]:
    """
    Search DuckDuckGo HTML endpoint.

    Scrapes results directly - no API key needed.

    Args:
        query: The search query.
        max_results: Max results to return.

    Returns:
        List of result dicts with title, url, snippet.
    """
    results = []

    try:
        params = {"q": query}
        headers = {
            "User-Agent": DDG_USER_AGENT,
            "Accept": "text/html",
            "Accept-Language": "en-US,en;q=0.9",
        }

        response = requests.get(
            DDG_HTML_URL,
            params=params,
            headers=headers,
            timeout=15,
        )
        response.raise_for_status()

        results = _parse_ddg_html(response.text, max_results)

        _log.debug("DDG SEARCH | query='%s' | results=%d", query[:50], len(results))

    except requests.exceptions.Timeout:
        _log.warning("DDG SEARCH | timeout for query='%s'", query[:50])
    except requests.exceptions.RequestException as exc:
        _log.error("DDG SEARCH | error: %s", exc)
    except Exception as exc:
        _log.error("DDG SEARCH | unexpected error: %s", exc)

    return results


def _parse_ddg_html(html: str, max_results: int) -> list[dict]:
    """
    Parse DuckDuckGo HTML response.

    Args:
        html: Raw HTML from DDG.
        max_results: Max results to extract.

    Returns:
        List of result dicts.
    """
    results = []

    result_pattern = re.compile(
        r'<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([^<]+)</a>.*?'
        r'<a[^>]+class="result__snippet"[^>]*>([^<]*(?:<[^>]+>[^<]*)*)</a>',
        re.DOTALL | re.IGNORECASE,
    )

    matches = result_pattern.findall(html)

    for url, title, snippet in matches[:max_results]:
        clean_url = _extract_ddg_url(url)
        clean_snippet = _clean_html(snippet)
        clean_title = _clean_html(title)

        if clean_url and clean_title:
            results.append(
                {
                    "title": clean_title,
                    "url": clean_url,
                    "snippet": clean_snippet,
                }
            )

    if not results:
        results = _parse_ddg_html_simple(html, max_results)

    return results


def _parse_ddg_html_simple(html: str, max_results: int) -> list[dict]:
    """
    Simple fallback parser for DDG HTML.

    Args:
        html: Raw HTML.
        max_results: Max results.

    Returns:
        List of result dicts.
    """
    results = []

    link_pattern = re.compile(
        r'<a[^>]+class="result__a"[^>]*>([^<]+)</a>', re.IGNORECASE
    )
    url_pattern = re.compile(
        r'<a[^>]+class="result__url"[^>]*>([^<]+)</a>', re.IGNORECASE
    )
    snippet_pattern = re.compile(
        r'<a[^>]+class="result__snippet"[^>]*>(.*?)</a>', re.DOTALL | re.IGNORECASE
    )

    titles = link_pattern.findall(html)
    urls = url_pattern.findall(html)
    snippets = snippet_pattern.findall(html)

    for i in range(min(len(titles), len(urls), max_results)):
        title = _clean_html(titles[i]) if i < len(titles) else ""
        url_raw = urls[i].strip() if i < len(urls) else ""
        snippet = _clean_html(snippets[i]) if i < len(snippets) else ""

        if not url_raw.startswith("http"):
            url_raw = "https://" + url_raw

        if title and url_raw:
            results.append(
                {
                    "title": title,
                    "url": url_raw,
                    "snippet": snippet,
                }
            )

    return results


def _extract_ddg_url(redirect_url: str) -> str:
    """
    Extract actual URL from DDG redirect URL.

    Args:
        redirect_url: DDG redirect URL.

    Returns:
        Actual target URL.
    """
    if "uddg=" in redirect_url:
        try:
            parsed = urllib.parse.urlparse(redirect_url)
            params = urllib.parse.parse_qs(parsed.query)
            if "uddg" in params:
                return params["uddg"][0]
        except Exception:
            pass

    if redirect_url.startswith("http"):
        return redirect_url

    return ""


def _clean_html(text: str) -> str:
    """
    Remove HTML tags and decode entities.

    Args:
        text: Text with HTML.

    Returns:
        Clean text.
    """
    text = re.sub(r"<[^>]+>", "", text)
    text = text.replace("&amp;", "&")
    text = text.replace("&lt;", "<")
    text = text.replace("&gt;", ">")
    text = text.replace("&quot;", '"')
    text = text.replace("&#39;", "'")
    text = text.replace("&nbsp;", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _searxng_search(query: str, max_results: int) -> list[dict]:
    """
    Search using SearXNG instance.

    Args:
        query: The search query.
        max_results: Max results to return.

    Returns:
        List of result dicts with title, url, snippet.
    """
    results = []

    if not config.SEARXNG_URL:
        return results

    try:
        search_url = f"{config.SEARXNG_URL.rstrip('/')}/search"
        params = {
            "q": query,
            "format": "json",
        }

        response = requests.get(
            search_url,
            params=params,
            timeout=15,
        )
        response.raise_for_status()

        data = response.json()

        for item in data.get("results", [])[:max_results]:
            results.append(
                {
                    "title": item.get("title", ""),
                    "url": item.get("url", ""),
                    "snippet": item.get("content", ""),
                }
            )

        _log.debug("SEARXNG SEARCH | query='%s' | results=%d", query[:50], len(results))

    except requests.exceptions.Timeout:
        _log.warning("SEARXNG SEARCH | timeout for query='%s'", query[:50])
    except requests.exceptions.RequestException as exc:
        _log.error("SEARXNG SEARCH | error: %s", exc)
    except Exception as exc:
        _log.error("SEARXNG SEARCH | unexpected error: %s", exc)

    return results


def search_images(query: str, max_results: int = 5) -> list[dict]:
    """
    Search for images.

    Args:
        query: The search query.
        max_results: Max results to return.

    Returns:
        List of image result dicts.

    Example:
        images = search_images("sunset beach")
    """
    _log.info("IMAGE SEARCH | query='%s'", query[:50])

    results = []

    try:
        params = {"q": query, "iax": "images", "ia": "images"}
        headers = {"User-Agent": DDG_USER_AGENT}

        response = requests.get(
            "https://duckduckgo.com/",
            params=params,
            headers=headers,
            timeout=15,
        )

        vqd_match = re.search(r"vqd='([^']+)'", response.text)
        if not vqd_match:
            vqd_match = re.search(r"vqd=([\"'])([^\"']+)\1", response.text)

        if vqd_match:
            vqd = vqd_match.group(1) if vqd_match.lastindex == 1 else vqd_match.group(2)

            api_url = "https://duckduckgo.com/i.js"
            api_params = {
                "l": "wt-wt",
                "o": "json",
                "q": query,
                "vqd": vqd,
                "f": ",,,",
                "p": "1",
            }

            api_response = requests.get(
                api_url,
                params=api_params,
                headers=headers,
                timeout=15,
            )

            if api_response.status_code == 200:
                data = api_response.json()
                for item in data.get("results", [])[:max_results]:
                    results.append(
                        {
                            "title": item.get("title", ""),
                            "url": item.get("image", ""),
                            "thumbnail": item.get("thumbnail", ""),
                            "source": item.get("url", ""),
                        }
                    )

    except Exception as exc:
        _log.error("IMAGE SEARCH | error: %s", exc)

    _log.info(
        "IMAGE SEARCH COMPLETE | query='%s' | results=%d", query[:50], len(results)
    )
    return results


def search_news(query: str, max_results: int = 5) -> list[dict]:
    """
    Search for news articles.

    Args:
        query: The search query.
        max_results: Max results to return.

    Returns:
        List of news result dicts.

    Example:
        news = search_news("AI developments")
    """
    _log.info("NEWS SEARCH | query='%s'", query[:50])

    results = []

    try:
        params = {"q": query, "iar": "news"}
        headers = {"User-Agent": DDG_USER_AGENT}

        response = requests.get(
            DDG_HTML_URL,
            params=params,
            headers=headers,
            timeout=15,
        )

        results = _parse_ddg_html(response.text, max_results)

        for r in results:
            r["type"] = "news"

    except Exception as exc:
        _log.error("NEWS SEARCH | error: %s", exc)

    return results
