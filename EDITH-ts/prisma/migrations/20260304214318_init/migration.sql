-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "channel" TEXT,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Thread" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "context" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TriggerLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "triggerName" TEXT NOT NULL,
    "actedOn" BOOLEAN NOT NULL DEFAULT false,
    "firedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "VoiceProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "profileName" TEXT NOT NULL,
    "cloneType" TEXT NOT NULL,
    "modelPath" TEXT,
    "referenceAudio" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PairingCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ApprovedUser" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "approvedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME
);

-- CreateTable
CREATE TABLE "DeviceToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL DEFAULT 'unknown',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsed" DATETIME NOT NULL,
    "revokedAt" DATETIME
);

-- CreateTable
CREATE TABLE "PairingSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "UserProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "facts" JSONB NOT NULL,
    "opinions" JSONB NOT NULL,
    "topics" JSONB NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MemoryNode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "validFrom" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" DATETIME,
    "category" TEXT NOT NULL,
    "embedding" BLOB,
    "utilityScore" REAL NOT NULL DEFAULT 0.5,
    "qValue" REAL NOT NULL DEFAULT 0.5,
    "metadata" JSONB,
    "retrievalCount" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "MemoryNodeFTS" (
    "rowid" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "content" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "UsageEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL,
    "completionTokens" INTEGER NOT NULL,
    "totalTokens" INTEGER NOT NULL,
    "estimatedCostUsd" REAL NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "requestType" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "errorType" TEXT,
    "timestamp" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT,
    "tier" TEXT NOT NULL DEFAULT 'free',
    "limits" JSONB NOT NULL,
    "features" JSONB NOT NULL,
    "customConfig" JSONB,
    "workspacePath" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastAccessedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CausalNode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
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
    CONSTRAINT "CausalEdge_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "CausalNode" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CausalEdge_toId_fkey" FOREIGN KEY ("toId") REFERENCES "CausalNode" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "HyperEdge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "memberSetHash" TEXT NOT NULL,
    "weight" REAL NOT NULL DEFAULT 0.5
);

-- CreateTable
CREATE TABLE "HyperEdgeMembership" (
    "hyperEdgeId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,

    PRIMARY KEY ("hyperEdgeId", "nodeId"),
    CONSTRAINT "HyperEdgeMembership_hyperEdgeId_fkey" FOREIGN KEY ("hyperEdgeId") REFERENCES "HyperEdge" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "HyperEdgeMembership_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "CausalNode" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Message_userId_createdAt_idx" ON "Message"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_channel_idx" ON "Message"("channel");

-- CreateIndex
CREATE INDEX "Message_userId_role_idx" ON "Message"("userId", "role");

-- CreateIndex
CREATE INDEX "Thread_userId_state_idx" ON "Thread"("userId", "state");

-- CreateIndex
CREATE INDEX "TriggerLog_userId_firedAt_idx" ON "TriggerLog"("userId", "firedAt");

-- CreateIndex
CREATE INDEX "VoiceProfile_userId_profileName_idx" ON "VoiceProfile"("userId", "profileName");

-- CreateIndex
CREATE INDEX "Document_userId_createdAt_idx" ON "Document"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Document_source_idx" ON "Document"("source");

-- CreateIndex
CREATE UNIQUE INDEX "PairingCode_code_key" ON "PairingCode"("code");

-- CreateIndex
CREATE INDEX "PairingCode_code_idx" ON "PairingCode"("code");

-- CreateIndex
CREATE INDEX "PairingCode_senderId_channel_idx" ON "PairingCode"("senderId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovedUser_userId_channel_key" ON "ApprovedUser"("userId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceToken_tokenHash_key" ON "DeviceToken"("tokenHash");

-- CreateIndex
CREATE INDEX "DeviceToken_userId_idx" ON "DeviceToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PairingSession_code_key" ON "PairingSession"("code");

-- CreateIndex
CREATE UNIQUE INDEX "UserProfile_userId_key" ON "UserProfile"("userId");

-- CreateIndex
CREATE INDEX "MemoryNode_userId_level_idx" ON "MemoryNode"("userId", "level");

-- CreateIndex
CREATE INDEX "MemoryNode_userId_validUntil_idx" ON "MemoryNode"("userId", "validUntil");

-- CreateIndex
CREATE INDEX "MemoryNode_userId_qValue_idx" ON "MemoryNode"("userId", "qValue");

-- CreateIndex
CREATE INDEX "MemoryNode_userId_utilityScore_idx" ON "MemoryNode"("userId", "utilityScore");

-- CreateIndex
CREATE INDEX "UsageEvent_userId_timestamp_idx" ON "UsageEvent"("userId", "timestamp");

-- CreateIndex
CREATE INDEX "UsageEvent_provider_model_idx" ON "UsageEvent"("provider", "model");

-- CreateIndex
CREATE INDEX "UsageEvent_timestamp_idx" ON "UsageEvent"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_tenantId_key" ON "Tenant"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_userId_key" ON "Tenant"("userId");

-- CreateIndex
CREATE INDEX "Tenant_tier_idx" ON "Tenant"("tier");

-- CreateIndex
CREATE INDEX "Tenant_createdAt_idx" ON "Tenant"("createdAt");

-- CreateIndex
CREATE INDEX "CausalNode_userId_category_idx" ON "CausalNode"("userId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "CausalNode_userId_eventKey_key" ON "CausalNode"("userId", "eventKey");

-- CreateIndex
CREATE INDEX "CausalEdge_userId_idx" ON "CausalEdge"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CausalEdge_fromId_toId_key" ON "CausalEdge"("fromId", "toId");

-- CreateIndex
CREATE INDEX "HyperEdge_userId_idx" ON "HyperEdge"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "HyperEdge_userId_relation_memberSetHash_key" ON "HyperEdge"("userId", "relation", "memberSetHash");
