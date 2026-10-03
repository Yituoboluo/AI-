import { requireSession } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { parseJson } from "@/lib/json";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

const PAGE_SIZES = [10, 20, 50, 100, 150];

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const url = new URL(req.url);
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const requestedPageSize = Number(url.searchParams.get("pageSize") || 50);
    const pageSize = PAGE_SIZES.includes(requestedPageSize) ? requestedPageSize : 50;
    const q = (url.searchParams.get("q") || "").trim();
    const status = (url.searchParams.get("status") || "").trim();
    const passed = (url.searchParams.get("passed") || "").trim();
    const review = (url.searchParams.get("review") || "all").trim();

    const task = await prisma.evaluationTask.findFirst({
      where: { id, userId: session.uid },
    });
    if (!task) return fail("评估任务不存在", 404);

    const where: Prisma.EvaluationResultWhereInput = { evaluationTaskId: id };
    if (status && status !== "all") {
      where.status = status;
    }
    if (passed === "true") {
      where.passed = true;
    } else if (passed === "false") {
      where.passed = false;
    } else if (passed === "null") {
      where.passed = null;
    }
    if (review === "pending") where.reviewVerdict = null;
    else if (review === "reviewed") where.reviewVerdict = { not: null };
    else if (["correct", "incorrect", "uncertain"].includes(review)) where.reviewVerdict = review;
    if (q) {
      const rowIndex = Number(q);
      where.AND = [
        {
          OR: [
            Number.isFinite(rowIndex) ? { rowIndex } : undefined,
            { status: { contains: q } },
            { reason: { contains: q } },
            { errorType: { contains: q } },
            { errorMessage: { contains: q } },
            { rawResponse: { contains: q } },
            { promptSnapshot: { contains: q } },
            { sourceResult: { inputData: { contains: q } } },
            { sourceResult: { outputs: { contains: q } } },
          ].filter(Boolean) as Prisma.EvaluationResultWhereInput[],
        },
      ];
    }

    const [total, rows, scoreAgg, passedCount] = await Promise.all([
      prisma.evaluationResult.count({ where }),
      prisma.evaluationResult.findMany({
        where,
        orderBy: { rowIndex: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          sourceResult: true,
          reviews: { orderBy: { revision: "desc" }, take: 1, include: { reviewer: { select: { username: true } } } },
        },
      }),
      prisma.evaluationResult.aggregate({
        where: { ...where, status: "success", score: { not: null } },
        _avg: { score: true },
      }),
      prisma.evaluationResult.count({
        where: { ...where, status: "success", passed: true },
      }),
    ]);

    const successCount = await prisma.evaluationResult.count({
      where: { ...where, status: "success" },
    });
    const reviewGroups = await prisma.evaluationResult.groupBy({
      by: ["reviewVerdict"], where: { evaluationTaskId: id }, _count: { _all: true },
    });
    const reviewCounts = { pending: 0, correct: 0, incorrect: 0, uncertain: 0 };
    for (const group of reviewGroups) {
      if (group.reviewVerdict === null) reviewCounts.pending = group._count._all;
      else if (group.reviewVerdict in reviewCounts) reviewCounts[group.reviewVerdict as keyof typeof reviewCounts] = group._count._all;
    }

    return ok({
      total,
      page,
      pageSize,
      avgScore: scoreAgg._avg.score ?? null,
      passRate: successCount > 0 ? passedCount / successCount : 0,
      successCount,
      reviewCounts,
      rows: rows.map((row) => ({
        ...row,
        latestReview: row.reviews[0] ?? null,
        promptSnapshot: parseJson(row.promptSnapshot, row.promptSnapshot),
        sourceOutputs: parseJson(row.sourceResult.outputs, {}),
        sourceInput: parseJson(row.sourceResult.inputData, {}),
      })),
    });
  } catch {
    return fail("查询评估结果失败", 500);
  }
}
