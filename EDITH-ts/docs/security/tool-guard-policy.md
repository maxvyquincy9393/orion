# Tool Guard Policy

File: `src/security/tool-guard.ts`

## Objective
Prevent high-risk terminal, file, and URL tool actions before execution.

## Terminal Guard
Checks:
- Deny list patterns (`rm -rf`, destructive formats, unsafe chains).
- Command chaining hazards (`;`, `&&`, command substitution abuse).
- Excessive traversal usage in command arguments.

Result:
- `allowed=false` and reason for blocked command.

## File Path Guard
Checks:
- Protected OS/system roots.
- Sensitive files (`.env`, SSH keys, cloud credentials).
- Traversal count threshold.

Action Modes:
- `read`
- `write`

## URL Guard
Checks:
- Invalid URL format.
- `file://` protocol rejection.
- Internal/private hosts to mitigate SSRF.

## Wrapper Mode
`wrapWithGuard()` attaches checks to tool `execute` functions.

## Policy Notes
- Guard is deny-by-pattern, not full semantic sandboxing.
- Guard failures return safe error text without throwing.
- Tool runtime errors are caught and logged.

## Recommended Tests
- Terminal: destructive command blocked.
- File: protected path blocked, safe path allowed.
- URL: localhost/metadata IP blocked, public host allowed.
