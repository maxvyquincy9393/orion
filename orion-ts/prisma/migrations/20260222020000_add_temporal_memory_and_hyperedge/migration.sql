-- Rebuild UserProfile for Hindsight/O-Mem profile split
CREATE TABLE "new_UserProfile" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "facts" JSONB NOT NULL,
  "opinions" JSONB NOT NULL,
  "topics" JSONB NOT NULL,
  "updatedAt" DATETIME NOT NULL
);

INSERT INTO "new_UserProfile" ("id", "userId", "facts", "opinions", "topics", "updatedAt")
SELECT
  "id",
  "userId",
  COALESCE("attributes", '[]'),
  '[]',
  "topics",
  "updatedAt"
FROM "UserProfile";

DROP TABLE "UserProfile";
ALTER TABLE "new_UserProfile" RENAME TO "UserProfile";
CREATE UNIQUE INDEX "UserProfile_userId_key" ON "UserProfile"("userId");

-- Temporal memory nodes (TiMem + Graphiti validity)
CREATE TABLE "MemoryNode" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "level" INTEGER NOT NULL,
  "validFrom" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "validUntil" DATETIME,
  "category" TEXT NOT NULL,
  "embedding" BLOB
);

CREATE INDEX "MemoryNode_userId_level_idx" ON "MemoryNode"("userId", "level");
CREATE INDEX "MemoryNode_userId_validUntil_idx" ON "MemoryNode"("userId", "validUntil");

-- Hyper-edge graph modeling (PersonalAI)
CREATE TABLE "HyperEdge" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "relation" TEXT NOT NULL,
  "context" TEXT NOT NULL,
  "weight" REAL NOT NULL DEFAULT 0.5
);

CREATE TABLE "HyperEdgeMembership" (
  "hyperEdgeId" TEXT NOT NULL,
  "nodeId" TEXT NOT NULL,
  CONSTRAINT "HyperEdgeMembership_hyperEdgeId_fkey" FOREIGN KEY ("hyperEdgeId") REFERENCES "HyperEdge" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "HyperEdgeMembership_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "CausalNode" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  PRIMARY KEY ("hyperEdgeId", "nodeId")
);

CREATE INDEX "HyperEdge_userId_idx" ON "HyperEdge"("userId");
