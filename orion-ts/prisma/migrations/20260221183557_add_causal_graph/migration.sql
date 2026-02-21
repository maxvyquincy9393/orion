-- CreateTable
CREATE TABLE "CausalNode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CausalEdge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "strength" REAL NOT NULL DEFAULT 0.5,
    "evidence" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CausalEdge_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "CausalNode" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CausalEdge_toId_fkey" FOREIGN KEY ("toId") REFERENCES "CausalNode" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CausalNode_userId_category_idx" ON "CausalNode"("userId", "category");

-- CreateIndex
CREATE INDEX "CausalEdge_userId_idx" ON "CausalEdge"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CausalEdge_fromId_toId_key" ON "CausalEdge"("fromId", "toId");
