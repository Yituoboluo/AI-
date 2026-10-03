import type { PrismaClient } from "@prisma/client";
import { REVIEW_LABELS, type ReviewVerdict } from "./review-types";

export class ReviewError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

type ReviewInput = {
  submissionKey: string;
  expectedVersion: number;
  verdict: ReviewVerdict;
  reason: string;
  correctedScore: number | null;
  correctedPassed: boolean | null;
};

export function isReviewSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    const actual = new URL(origin);
    const internal = new URL(req.url);
    // Next can construct req.url with localhost even when the browser uses 127.0.0.1.
    const host = req.headers.get("host") || internal.host;
    return actual.host === host && actual.protocol === internal.protocol;
  } catch { return false; }
}

export function validateReview(value: unknown, scoreMin: number, scoreMax: number): ReviewInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ReviewError("复核内容格式不正确", 400);
  const body = value as Record<string, unknown>;
  if (typeof body.verdict !== "string" || !Object.hasOwn(REVIEW_LABELS, body.verdict)) throw new ReviewError("请选择复核判断", 400);
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason || reason.length > 4000) throw new ReviewError("请填写复核理由，最多 4000 字", 400);
  if (typeof body.submissionKey !== "string" || !/^[a-f0-9-]{36}$/i.test(body.submissionKey)) throw new ReviewError("提交标识无效，请刷新后重试", 400);
  if (!Number.isSafeInteger(body.expectedVersion) || (body.expectedVersion as number) < 0) throw new ReviewError("复核版本无效", 400);
  const correctedScore = body.correctedScore ?? null;
  const correctedPassed = body.correctedPassed ?? null;
  if (correctedScore !== null && (typeof correctedScore !== "number" || !Number.isFinite(correctedScore) || correctedScore < scoreMin || correctedScore > scoreMax)) {
    throw new ReviewError(`人工分数须在 ${scoreMin}–${scoreMax} 之间`, 400);
  }
  if (correctedPassed !== null && typeof correctedPassed !== "boolean") throw new ReviewError("人工通过结论无效", 400);
  if (body.verdict !== "incorrect" && (correctedScore !== null || correctedPassed !== null)) throw new ReviewError("只有判错时可填写修正结论", 400);
  return {
    submissionKey: body.submissionKey,
    expectedVersion: body.expectedVersion as number,
    verdict: body.verdict as ReviewVerdict,
    reason,
    correctedScore: correctedScore as number | null,
    correctedPassed: correctedPassed as boolean | null,
  };
}

export async function saveReview(db: PrismaClient, resultId: string, userId: string, value: unknown) {
  return db.$transaction(async (tx) => {
    const result = await tx.evaluationResult.findFirst({
      where: { id: resultId, evaluationTask: { userId } },
      include: { evaluationTask: { include: { evaluator: true } } },
    });
    if (!result) throw new ReviewError("评估结果不存在", 404);
    const input = validateReview(value, result.evaluationTask.evaluator.scoreMin, result.evaluationTask.evaluator.scoreMax);
    const existing = await tx.evaluationReview.findUnique({ where: { submissionKey: input.submissionKey }, include: { reviewer: { select: { username: true } } } });
    if (existing) {
      if (existing.evaluationResultId !== resultId || existing.reviewerId !== userId || existing.verdict !== input.verdict || existing.reason !== input.reason || existing.correctedScore !== input.correctedScore || existing.correctedPassed !== input.correctedPassed) {
        throw new ReviewError("该提交标识已使用，请重新打开复核", 409);
      }
      return existing;
    }
    const update = await tx.evaluationResult.updateMany({
      where: { id: resultId, reviewVersion: input.expectedVersion },
      data: { reviewVersion: { increment: 1 }, reviewVerdict: input.verdict },
    });
    if (update.count !== 1) throw new ReviewError("已有新的复核记录，请重新打开后再保存", 409);
    return tx.evaluationReview.create({
      data: {
        submissionKey: input.submissionKey,
        evaluationResultId: resultId,
        reviewerId: userId,
        revision: input.expectedVersion + 1,
        verdict: input.verdict,
        reason: input.reason,
        correctedScore: input.correctedScore,
        correctedPassed: input.correctedPassed,
        aiScore: result.score,
        aiPassed: result.passed,
        aiReason: result.reason,
      },
      include: { reviewer: { select: { username: true } } },
    });
  });
}
