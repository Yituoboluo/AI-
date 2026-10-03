-- Additive migration: retain every original evaluation and score.
ALTER TABLE "EvaluationResult" ADD COLUMN "reviewVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "EvaluationResult" ADD COLUMN "reviewVerdict" TEXT;
CREATE INDEX "EvaluationResult_evaluationTaskId_reviewVerdict_idx"
  ON "EvaluationResult"("evaluationTaskId", "reviewVerdict");

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
