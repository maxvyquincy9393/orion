# EDITH Desktop

Electron wrapper for EDITH gateway.

## Run

```bash
pnpm dev
```

## Build

```bash
pnpm build -- --dir
```

If build fails with missing module errors (for example `stat-mode`), refresh dependencies:

```bash
pnpm install --force
```
