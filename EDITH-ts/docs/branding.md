# EDITH Branding Contract

Official product identity for this repository is `EDITH`.

EDITH expands to: `Even Dead, I'm The Hero`.

## Rules

- Use `EDITH` for the product name in user-facing text, docs, UI labels, banners, and operator workflows.
- Treat `Nova` and `Orion` as legacy names that may still exist in old filenames, config paths, tests, or internal symbols.
- Treat `jarvis` as a legacy mode alias for the OS-agent experience, not as a competing product name.
- Treat `tars` as an internal voice preset label, not as a separate voice product brand.
- Treat `OpenClaw` only as an architectural reference or inspiration source.

## Practical Guidance

- Prefer compatibility aliases over breaking renames for env vars, config files, and CLI flags unless the migration is explicit.
- When touching a user-visible string, move it toward `EDITH`.
- When touching internal implementation names, only rename if the value of the cleanup is worth the migration risk.
- Do not introduce new top-level codenames without also updating this contract.
