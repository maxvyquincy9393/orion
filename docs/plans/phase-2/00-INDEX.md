# Phase 2 — Planning Index

**Total test files yang harus dibuat:** 8  
**Total tests:** 88+  
**Coverage target:** ≥80% per module  
**Status saat ini:** Hanya `voice-config.test.ts` dan `voice-plan.test.ts` yang ada

---

## Urutan pengerjaan (dependency order)

Kerjakan **satu file per sesi** — selesaikan satu sebelum lanjut ke berikutnya.

| # | File | MD Planning | Status | Atom |
|---|------|-------------|--------|------|
| 0 | `test-helpers.ts` (infra) | [01-TEST-HELPERS.md](./01-TEST-HELPERS.md) | ⬜ TODO | Atom 0 |
| 1 | `system-monitor.test.ts` | [02-SYSTEM-MONITOR.md](./02-SYSTEM-MONITOR.md) | ⬜ TODO | Atom 1 |
| 2 | `gui-agent.test.ts` | [03-GUI-AGENT.md](./03-GUI-AGENT.md) | ⬜ TODO | Atom 2 |
| 3 | `vision-cortex.test.ts` | [04-VISION-CORTEX.md](./04-VISION-CORTEX.md) | ⬜ TODO | Atom 3 |
| 4 | `voice-io.test.ts` | [05-VOICE-IO.md](./05-VOICE-IO.md) | ⬜ TODO | Atom 4 |
| 5 | `iot-bridge.test.ts` | [06-IOT-BRIDGE.md](./06-IOT-BRIDGE.md) | ⬜ TODO | Atom 5 |
| 6 | `perception-fusion.test.ts` | [07-PERCEPTION-FUSION.md](./07-PERCEPTION-FUSION.md) | ⬜ TODO | Atom 6 |
| 7 | `os-agent-tool.test.ts` | [08-OS-AGENT-TOOL.md](./08-OS-AGENT-TOOL.md) | ⬜ TODO | Atom 7 |
| 8 | `os-agent-index.test.ts` | [09-OS-AGENT-INDEX.md](./09-OS-AGENT-INDEX.md) | ⬜ TODO | Atom 8 |

---

## Cara pakai planning ini

1. Buka MD untuk atom yang sedang dikerjakan
2. Baca section **"Apa yang Harus Diperbaiki"** dulu — ini masalah di source code yang perlu diketahui
3. Baca **"Mock Setup"** — ini blok vi.mock yang wajib ada di top of file
4. Tulis tests sesuai urutan di **"Test Cases Detail"**
5. Checklist ✅ setiap test setelah pass
6. Update status di tabel ini menjadi ✅ DONE

---

## Shared rule untuk semua test files

```typescript
// Semua test file WAJIB:
// 1. Import dari vitest (bukan jest)
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// 2. Mock SEBELUM import source file
vi.mock("execa", ...)
vi.mock("node:fs/promises", ...)
// dst

// 3. Gunakan beforeEach untuk reset mocks
beforeEach(() => { vi.clearAllMocks() })

// 4. JANGAN gunakan real execa, real fs, real fetch, real os di unit tests
```
