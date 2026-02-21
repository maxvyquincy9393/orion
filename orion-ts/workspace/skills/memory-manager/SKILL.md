---
name: memory-manager
description: "Save facts to MEMORY.md, update user profile in USER.md, and manage long-term memory."
version: 1.0.0
metadata:
  openclaw:
    alwaysActive: true
    emoji: "🧠"
---

# Memory Manager

## When to Save to MEMORY.md

Save ONLY if ALL of these are true:
- High confidence (not speculation)
- Stable (unlikely to change frequently)
- Important (genuinely useful for future conversations)
- User explicitly asked to remember it, OR it is a key biographical/preference fact

Format: `- [YYYY-MM-DD] fact`

Examples to save:
- User's job title, company
- Important preferences
- Key life context (family situation, major project)
- Things user explicitly said "remember this"

Examples NOT to save:
- Temporary tasks or to-dos
- Current mood or emotional state
- Information that might change next week
- Speculative inferences

## When to Update USER.md

Update USER.md when:
- You learn user's name, timezone, language preference
- Work context changes (new job, project)
- Communication preference is detected from patterns
- Technical level is established

Use the updateUserMd tool or write the file directly.

## Memory Search

Use `memory_search` with natural language queries.
Combine with recent conversation context for best recall.
If nothing is found via search, check episodic logs in memory/YYYY-MM-DD.md.

## Daily Episodic Logs

Append to memory/YYYY-MM-DD.md at end of significant interactions:
- Key topics discussed
- Decisions made
- Important facts learned
- Tasks completed or started

Keep concise - highlights only, not full transcripts.
