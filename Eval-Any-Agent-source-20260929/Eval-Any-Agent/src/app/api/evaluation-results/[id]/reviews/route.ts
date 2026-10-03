import { requireSession } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { isReviewSameOrigin, ReviewError, saveReview } from "@/lib/manual-review";
import { collectEvidence, objectValue } from "@/lib/review-evidence";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const result = await prisma.evaluationResult.findFirst({
      where: { id, evaluationTask: { userId: session.uid } },
      include: {
        sourceResult: true,
        evaluationTask: { include: { evaluator: { select: { name: true, scoreMin: true, scoreMax: true, passThreshold: true, systemPrompt: true } } } },
        reviews: { orderBy: { revision: "desc" }, include: { reviewer: { select: { username: true } } } },
      },
    });
    if (!result) return fail("评估结果不存在", 404);
    const sourceInput = objectValue(result.sourceResult.inputData);
    const sourceOutputs = objectValue(result.sourceResult.outputs);
    return ok({
      id: result.id, rowIndex: result.rowIndex, score: result.score, passed: result.passed, reason: result.reason, status: result.status,
      reviewVersion: result.reviewVersion, sourceInput, sourceOutputs,
      evaluator: result.evaluationTask.evaluator,
      images: collectEvidence(sourceInput, sourceOutputs).map(({ key, label, title }) => ({ key, label, title, url: `/api/evaluation-results/${encodeURIComponent(id)}/evidence?key=${encodeURIComponent(key)}` })),
      reviews: result.reviews,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return fail("请先登录", 401);
    return fail("读取人工复核失败", 500);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    if (!isReviewSameOrigin(req)) return fail("请求来源不正确", 403);
    const { id } = await params;
    let body: unknown;
    try { body = await req.json(); } catch { return fail("复核内容格式不正确", 400); }
    return ok(await saveReview(prisma, id, session.uid, body));
  } catch (error) {
    if (error instanceof ReviewError) return fail(error.message, error.status);
    if (error instanceof Error && error.message === "UNAUTHORIZED") return fail("请先登录", 401);
    return fail("保存失败，请保留填写内容并重试", 500);
  }
}
