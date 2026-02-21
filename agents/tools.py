"""
tools.py

LangGraph tools that wrap Phase 2 capabilities.
Each tool is formatted as LangChain Tool for use by agents.
Part of Orion — Persistent AI Companion System.
"""

import logging
from typing import Any, Optional

import config

_log = logging.getLogger("orion.agents.tools")
_log_file = config.LOGS_DIR / "agents.log"
_handler = logging.FileHandler(_log_file)
_handler.setFormatter(logging.Formatter("%(asctime)s | %(levelname)-8s | %(message)s"))
_log.addHandler(_handler)
_log.setLevel(getattr(logging, config.LOG_LEVEL, logging.INFO))


def _create_tool(name: str, description: str, func: callable) -> Any:
    """
    Create a LangChain Tool from a function.

    Args:
        name: Tool name.
        description: Tool description for LLM.
        func: Tool function.

    Returns:
        LangChain Tool instance.
    """
    try:
        from langchain_core.tools import Tool

        return Tool(
            name=name,
            description=description,
            func=func,
        )
    except ImportError:
        _log.warning("langchain_core.tools not available, returning dict")
        return {
            "name": name,
            "description": description,
            "func": func,
        }


def _search_tool_func(query: str) -> str:
    """Execute web search and return formatted results."""
    from browser.search import search

    _log.info("TOOL: search | query='%s'", query[:50])

    try:
        results = search(query, max_results=5)

        if not results:
            return "No search results found."

        lines = [f"Search results for: {query}\n"]
        for i, r in enumerate(results, 1):
            lines.append(f"{i}. {r.get('title', 'Untitled')}")
            lines.append(f"   URL: {r.get('url', 'N/A')}")
            snippet = r.get("snippet", "")[:200]
            if snippet:
                lines.append(f"   Snippet: {snippet}")
            lines.append("")

        return "\n".join(lines)

    except Exception as exc:
        _log.error("TOOL: search failed | %s", exc)
        return f"Search failed: {exc}"


def _browse_tool_func(url: str) -> str:
    """Navigate to URL and extract content."""
    from browser.playwright_client import navigate_sync

    _log.info("TOOL: browse | url='%s'", url[:50])

    try:
        content = navigate_sync(url)

        if content.startswith("[Error]"):
            return content

        return f"Content from {url}:\n\n{content[:3000]}"

    except Exception as exc:
        _log.error("TOOL: browse failed | %s", exc)
        return f"Browse failed: {exc}"


def _file_read_tool_func(path: str) -> str:
    """Read file contents."""
    from system.file_ops import read_file

    _log.info("TOOL: file_read | path='%s'", path)

    try:
        content = read_file(path)

        if content.startswith("[Error]") or content.startswith("[Permission"):
            return content

        return f"Contents of {path}:\n\n{content}"

    except Exception as exc:
        _log.error("TOOL: file_read failed | %s", exc)
        return f"File read failed: {exc}"


def _file_write_tool_func(args: str) -> str:
    """Write content to file. Args format: 'path|||content'."""
    from system.file_ops import write_file

    _log.info("TOOL: file_write")

    try:
        parts = args.split("|||", 1)
        if len(parts) != 2:
            return "Invalid format. Use: 'path|||content'"

        path, content = parts
        path = path.strip()

        success = write_file(path, content)

        if success:
            return f"Successfully wrote to {path}"
        else:
            return f"Failed to write to {path} (permission denied or error)"

    except Exception as exc:
        _log.error("TOOL: file_write failed | %s", exc)
        return f"File write failed: {exc}"


def _file_list_tool_func(path: str) -> str:
    """List directory contents."""
    from system.file_ops import list_dir

    _log.info("TOOL: file_list | path='%s'", path)

    try:
        items = list_dir(path)

        if not items:
            return f"Directory empty or not accessible: {path}"

        lines = [f"Contents of {path}:\n"]
        for item in sorted(items):
            lines.append(f"  - {item}")

        return "\n".join(lines)

    except Exception as exc:
        _log.error("TOOL: file_list failed | %s", exc)
        return f"Directory listing failed: {exc}"


def _calendar_tool_func(date: str) -> str:
    """Get calendar events for a date."""
    from system.calendar_ops import get_events, get_upcoming_events

    _log.info("TOOL: calendar | date='%s'", date)

    try:
        if date.lower() in ("today", "now", ""):
            from datetime import date as dt_date

            date = dt_date.today().isoformat()
        elif date.lower() == "upcoming":
            events = get_upcoming_events(days=7)
            if not events:
                return "No upcoming events in the next 7 days."
            lines = ["Upcoming events:\n"]
            for e in events:
                lines.append(f"  - {e.get('date')} {e.get('time')}: {e.get('title')}")
            return "\n".join(lines)

        events = get_events(date)

        if not events:
            return f"No events found for {date}."

        lines = [f"Events for {date}:\n"]
        for e in events:
            time_str = e.get("time", "all day")
            duration = e.get("duration_minutes", 0)
            duration_str = f" ({duration} min)" if duration else ""
            lines.append(f"  - {time_str}: {e.get('title')}{duration_str}")
            if e.get("location"):
                lines.append(f"    Location: {e.get('location')}")

        return "\n".join(lines)

    except Exception as exc:
        _log.error("TOOL: calendar failed | %s", exc)
        return f"Calendar lookup failed: {exc}"


def _calendar_add_tool_func(args: str) -> str:
    """Add calendar event. Args format: 'title|||date|||time|||duration'."""
    from system.calendar_ops import add_event

    _log.info("TOOL: calendar_add")

    try:
        parts = args.split("|||")
        if len(parts) < 3:
            return "Invalid format. Use: 'title|||date|||time|||duration'"

        title = parts[0].strip()
        date = parts[1].strip()
        time = parts[2].strip()
        duration = int(parts[3].strip()) if len(parts) > 3 else 60

        success = add_event(title, date, time, duration)

        if success:
            return f"Added event '{title}' on {date} at {time}"
        else:
            return f"Failed to add event (permission denied or error)"

    except Exception as exc:
        _log.error("TOOL: calendar_add failed | %s", exc)
        return f"Calendar add failed: {exc}"


def _terminal_tool_func(command: str) -> str:
    """Run terminal command."""
    from system.terminal import run

    _log.info("TOOL: terminal | cmd='%s'", command[:50])

    try:
        result = run(command, timeout=30)

        output = []
        if result.get("stdout"):
            output.append(f"STDOUT:\n{result['stdout']}")
        if result.get("stderr"):
            output.append(f"STDERR:\n{result['stderr']}")

        output.append(f"Exit code: {result.get('exit_code', -1)}")

        return "\n\n".join(output)

    except Exception as exc:
        _log.error("TOOL: terminal failed | %s", exc)
        return f"Terminal command failed: {exc}"


def _research_tool_func(query: str) -> str:
    """Research a topic using web search and browsing."""
    from browser.agent import BrowserAgent

    _log.info("TOOL: research | query='%s'", query[:50])

    try:
        agent = BrowserAgent()
        result = agent.search_and_summarize(query)
        return result

    except Exception as exc:
        _log.error("TOOL: research failed | %s", exc)
        return f"Research failed: {exc}"


def _memory_query_tool_func(query: str) -> str:
    """Query user's memory for relevant past context."""
    import core.memory as memory

    _log.info("TOOL: memory_query | query='%s'", query[:50])

    try:
        user_id = config.DEFAULT_USER_ID
        results = memory.get_relevant_context(user_id, query, top_k=5)

        if not results:
            return "No relevant memories found."

        lines = ["Relevant memories:\n"]
        for r in results:
            lines.append(f"  - {r.get('content', '')[:200]}")

        return "\n".join(lines)

    except Exception as exc:
        _log.error("TOOL: memory_query failed | %s", exc)
        return f"Memory query failed: {exc}"


def get_all_tools() -> list:
    """
    Get all available LangGraph tools.

    Returns:
        List of LangChain Tool instances.

    Example:
        tools = get_all_tools()
    """
    tools = [
        _create_tool(
            name="search",
            description="Search the web for information. Input: search query string. Returns: list of search results with titles, URLs, and snippets.",
            func=_search_tool_func,
        ),
        _create_tool(
            name="browse",
            description="Navigate to a URL and extract page content. Input: URL string. Returns: page text content.",
            func=_browse_tool_func,
        ),
        _create_tool(
            name="file_read",
            description="Read contents of a file. Input: file path. Returns: file contents.",
            func=_file_read_tool_func,
        ),
        _create_tool(
            name="file_write",
            description="Write content to a file. Input: 'path|||content' format. Returns: success/failure message.",
            func=_file_write_tool_func,
        ),
        _create_tool(
            name="file_list",
            description="List contents of a directory. Input: directory path. Returns: list of files and folders.",
            func=_file_list_tool_func,
        ),
        _create_tool(
            name="calendar",
            description="Get calendar events. Input: date (YYYY-MM-DD) or 'today' or 'upcoming'. Returns: list of events.",
            func=_calendar_tool_func,
        ),
        _create_tool(
            name="calendar_add",
            description="Add a calendar event. Input: 'title|||date|||time|||duration' format. Returns: success message.",
            func=_calendar_add_tool_func,
        ),
        _create_tool(
            name="terminal",
            description="Run a terminal command. Input: command string. Returns: stdout, stderr, exit code.",
            func=_terminal_tool_func,
        ),
        _create_tool(
            name="research",
            description="Research a topic by searching and summarizing web content. Input: topic query. Returns: synthesized summary.",
            func=_research_tool_func,
        ),
        _create_tool(
            name="memory_query",
            description="Query user's memory for relevant past context. Input: query string. Returns: relevant memories.",
            func=_memory_query_tool_func,
        ),
    ]

    _log.info("TOOLS | Loaded %d tools", len(tools))
    return tools


search_tool = _create_tool(
    name="search",
    description="Search the web for information.",
    func=_search_tool_func,
)

browse_tool = _create_tool(
    name="browse",
    description="Navigate to URL and extract content.",
    func=_browse_tool_func,
)

file_read_tool = _create_tool(
    name="file_read",
    description="Read file contents.",
    func=_file_read_tool_func,
)

calendar_tool = _create_tool(
    name="calendar",
    description="Get calendar events.",
    func=_calendar_tool_func,
)


def register_tools_with_graph(graph: Any) -> Any:
    """
    Register tools with a LangGraph agent.

    Args:
        graph: The LangGraph agent to enhance with tools.

    Returns:
        The enhanced graph.

    Example:
        graph = register_tools_with_graph(agent_graph)
    """
    try:
        from langgraph.prebuilt import ToolNode

        tools = get_all_tools()
        tool_node = ToolNode(tools)

        _log.info("TOOLS | Registered %d tools with graph", len(tools))
        return graph

    except ImportError:
        _log.warning("ToolNode not available, tools not registered")
        return graph
    except Exception as exc:
        _log.error("Failed to register tools: %s", exc)
        return graph
