-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MemoryNode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "validFrom" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" DATETIME,
    "category" TEXT NOT NULL,
    "embedding" BLOB,
    "utilityScore" REAL NOT NULL DEFAULT 0.5,
    "retrievalCount" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0
);
INSERT INTO "new_MemoryNode" ("category", "content", "embedding", "id", "level", "userId", "validFrom", "validUntil") SELECT "category", "content", "embedding", "id", "level", "userId", "validFrom", "validUntil" FROM "MemoryNode";
DROP TABLE "MemoryNode";
ALTER TABLE "new_MemoryNode" RENAME TO "MemoryNode";
CREATE INDEX "MemoryNode_userId_level_idx" ON "MemoryNode"("userId", "level");
CREATE INDEX "MemoryNode_userId_validUntil_idx" ON "MemoryNode"("userId", "validUntil");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
