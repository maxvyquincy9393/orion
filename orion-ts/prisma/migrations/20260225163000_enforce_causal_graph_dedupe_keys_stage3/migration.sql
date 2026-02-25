-- Stage 3 (breaking if Stage 2 maintenance was skipped):
-- - enforce non-null dedupe keys
-- - enforce unique constraints for causal nodes and hyperedges
-- Preconditions:
--   1) writer already populates eventKey/memberSetHash
--   2) dedupe CLI has been run and duplicate groups are zero
--   3) memberSetHash backfill completed (non-null)

PRAGMA foreign_keys=OFF;

-- Rebuild CausalNode to make eventKey NOT NULL.
-- We opportunistically derive eventKey from event if the column is still null/blank,
-- but uniqueness enforcement will still fail if duplicate rows remain.
CREATE TABLE "new_CausalNode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "new_CausalNode" ("id", "userId", "event", "eventKey", "category", "createdAt")
SELECT
    "id",
    "userId",
    "event",
    COALESCE(NULLIF(TRIM("eventKey"), ''), LOWER(TRIM("event"))) AS "eventKey",
    "category",
    "createdAt"
FROM "CausalNode";

DROP TABLE "CausalNode";
ALTER TABLE "new_CausalNode" RENAME TO "CausalNode";

CREATE INDEX "CausalNode_userId_category_idx" ON "CausalNode"("userId", "category");
CREATE UNIQUE INDEX "CausalNode_userId_eventKey_key" ON "CausalNode"("userId", "eventKey");

-- Rebuild HyperEdge to make memberSetHash NOT NULL.
-- This step intentionally does not derive hashes in SQL; if hashes are still missing,
-- the migration should fail so operators run the dedupe CLI backfill first.
CREATE TABLE "new_HyperEdge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "memberSetHash" TEXT NOT NULL,
    "weight" REAL NOT NULL DEFAULT 0.5
);

INSERT INTO "new_HyperEdge" ("id", "userId", "relation", "context", "memberSetHash", "weight")
SELECT
    "id",
    "userId",
    "relation",
    "context",
    NULLIF(TRIM("memberSetHash"), '') AS "memberSetHash",
    "weight"
FROM "HyperEdge";

DROP TABLE "HyperEdge";
ALTER TABLE "new_HyperEdge" RENAME TO "HyperEdge";

CREATE INDEX "HyperEdge_userId_idx" ON "HyperEdge"("userId");
CREATE UNIQUE INDEX "HyperEdge_userId_relation_memberSetHash_key"
ON "HyperEdge"("userId", "relation", "memberSetHash");

PRAGMA foreign_keys=ON;
