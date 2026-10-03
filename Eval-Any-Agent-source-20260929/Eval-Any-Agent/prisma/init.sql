-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Dataset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "columns" TEXT NOT NULL,
    "rows" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Dataset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MappingProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "datasetId" TEXT,
    "name" TEXT NOT NULL,
    "upstreamUrl" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'POST',
    "requestTemplate" TEXT NOT NULL,
    "headers" TEXT NOT NULL,
    "inputBindings" TEXT NOT NULL,
    "extractRules" TEXT NOT NULL,
    "expectedSchema" TEXT,
    "streamProtocol" TEXT NOT NULL DEFAULT 'auto',
    "doneStrategy" TEXT NOT NULL DEFAULT 'auto',
    "doneRules" TEXT NOT NULL,
    "doneRequired" BOOLEAN NOT NULL DEFAULT false,
    "timeoutMs" INTEGER NOT NULL DEFAULT 60000,
    "retryCount" INTEGER NOT NULL DEFAULT 2,
    "conversationIdMode" TEXT NOT NULL DEFAULT 'preserve',
    "conversationIdEvery" INTEGER NOT NULL DEFAULT 1,
    "idleTimeoutMs" INTEGER NOT NULL DEFAULT 15000,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MappingProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MappingProfile_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EvalTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "concurrency" INTEGER NOT NULL,
    "timeoutMs" INTEGER NOT NULL,
    "retryCount" INTEGER NOT NULL,
    "conversationIdMode" TEXT NOT NULL DEFAULT 'preserve',
    "conversationIdEvery" INTEGER NOT NULL DEFAULT 1,
    "totalRows" INTEGER NOT NULL,
    "successRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "startedAt" DATETIME,
    "endedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EvalTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EvalTask_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EvalTask_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "MappingProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EvalResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "inputData" TEXT NOT NULL,
    "requestPayload" TEXT,
    "outputs" TEXT NOT NULL,
    "ttftMs" INTEGER,
    "latencyMs" INTEGER,
    "status" TEXT NOT NULL,
    "errorType" TEXT,
    "errorMessage" TEXT,
    "endReason" TEXT,
    "ruleHit" TEXT,
    "rawTrace" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EvalResult_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "EvalTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LlmProviderConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "providerType" TEXT NOT NULL DEFAULT 'openai_compatible',
    "baseUrl" TEXT NOT NULL,
    "apiKeyEncrypted" TEXT NOT NULL,
    "defaultModel" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LlmProviderConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Evaluator" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "providerConfigId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "userPromptTemplate" TEXT NOT NULL,
    "thinkingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "scoreMin" REAL NOT NULL DEFAULT 0,
    "scoreMax" REAL NOT NULL DEFAULT 100,
    "passThreshold" REAL NOT NULL DEFAULT 60,
    "notifyDingTalk" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Evaluator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Evaluator_providerConfigId_fkey" FOREIGN KEY ("providerConfigId") REFERENCES "LlmProviderConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EvaluationTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "sourceTaskId" TEXT NOT NULL,
    "evaluatorId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "totalRows" INTEGER NOT NULL,
    "successRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "skippedRows" INTEGER NOT NULL DEFAULT 0,
    "notifyDingTalk" BOOLEAN NOT NULL DEFAULT false,
    "avgScore" REAL,
    "startedAt" DATETIME,
    "endedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EvaluationTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EvaluationTask_sourceTaskId_fkey" FOREIGN KEY ("sourceTaskId") REFERENCES "EvalTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EvaluationTask_evaluatorId_fkey" FOREIGN KEY ("evaluatorId") REFERENCES "Evaluator" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EvaluationResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "evaluationTaskId" TEXT NOT NULL,
    "sourceResultId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "score" REAL,
    "passed" BOOLEAN,
    "reason" TEXT,
    "status" TEXT NOT NULL,
    "errorType" TEXT,
    "errorMessage" TEXT,
    "promptSnapshot" TEXT NOT NULL,
    "rawResponse" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EvaluationResult_evaluationTaskId_fkey" FOREIGN KEY ("evaluationTaskId") REFERENCES "EvaluationTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EvaluationResult_sourceResultId_fkey" FOREIGN KEY ("sourceResultId") REFERENCES "EvalResult" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScheduledTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "concurrency" INTEGER NOT NULL DEFAULT 20,
    "timeoutMs" INTEGER NOT NULL DEFAULT 60000,
    "retryCount" INTEGER NOT NULL DEFAULT 2,
    "scheduleType" TEXT NOT NULL,
    "conversationIdMode" TEXT NOT NULL DEFAULT 'preserve',
    "conversationIdEvery" INTEGER NOT NULL DEFAULT 1,
    "cronExpr" TEXT,
    "intervalMs" INTEGER,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    "notifyDingTalk" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" DATETIME,
    "nextRunAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ScheduledTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ScheduledTask_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ScheduledTask_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "MappingProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "Dataset_userId_idx" ON "Dataset"("userId");

-- CreateIndex
CREATE INDEX "MappingProfile_userId_idx" ON "MappingProfile"("userId");

-- CreateIndex
CREATE INDEX "MappingProfile_datasetId_idx" ON "MappingProfile"("datasetId");

-- CreateIndex
CREATE INDEX "EvalTask_userId_idx" ON "EvalTask"("userId");

-- CreateIndex
CREATE INDEX "EvalTask_datasetId_idx" ON "EvalTask"("datasetId");

-- CreateIndex
CREATE INDEX "EvalTask_profileId_idx" ON "EvalTask"("profileId");

-- CreateIndex
CREATE INDEX "EvalResult_taskId_idx" ON "EvalResult"("taskId");

-- CreateIndex
CREATE INDEX "EvalResult_rowIndex_idx" ON "EvalResult"("rowIndex");

-- CreateIndex
CREATE INDEX "LlmProviderConfig_userId_idx" ON "LlmProviderConfig"("userId");

-- CreateIndex
CREATE INDEX "Evaluator_userId_idx" ON "Evaluator"("userId");

-- CreateIndex
CREATE INDEX "Evaluator_providerConfigId_idx" ON "Evaluator"("providerConfigId");

-- CreateIndex
CREATE INDEX "EvaluationTask_userId_idx" ON "EvaluationTask"("userId");

-- CreateIndex
CREATE INDEX "EvaluationTask_sourceTaskId_idx" ON "EvaluationTask"("sourceTaskId");

-- CreateIndex
CREATE INDEX "EvaluationTask_evaluatorId_idx" ON "EvaluationTask"("evaluatorId");

-- CreateIndex
CREATE INDEX "EvaluationResult_evaluationTaskId_idx" ON "EvaluationResult"("evaluationTaskId");

-- CreateIndex
CREATE INDEX "EvaluationResult_sourceResultId_idx" ON "EvaluationResult"("sourceResultId");

-- CreateIndex
CREATE INDEX "EvaluationResult_rowIndex_idx" ON "EvaluationResult"("rowIndex");

CREATE INDEX "ScheduledTask_userId_enabled_nextRunAt_idx" ON "ScheduledTask"("userId", "enabled", "nextRunAt");

-- Manual review schema for a fresh installation.
ALTER TABLE "EvaluationResult" ADD COLUMN "reviewVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "EvaluationResult" ADD COLUMN "reviewVerdict" TEXT;
CREATE INDEX "EvaluationResult_evaluationTaskId_reviewVerdict_idx" ON "EvaluationResult"("evaluationTaskId", "reviewVerdict");
CREATE TABLE "EvaluationReview" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "submissionKey" TEXT NOT NULL,
  "evaluationResultId" TEXT NOT NULL,
  "reviewerId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "verdict" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "correctedScore" REAL,
  "correctedPassed" BOOLEAN,
  "aiScore" REAL,
  "aiPassed" BOOLEAN,
  "aiReason" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EvaluationReview_evaluationResultId_fkey" FOREIGN KEY ("evaluationResultId") REFERENCES "EvaluationResult"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "EvaluationReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EvaluationReview_submissionKey_key" ON "EvaluationReview"("submissionKey");
CREATE UNIQUE INDEX "EvaluationReview_evaluationResultId_revision_key" ON "EvaluationReview"("evaluationResultId", "revision");
CREATE INDEX "EvaluationReview_reviewerId_idx" ON "EvaluationReview"("reviewerId");
