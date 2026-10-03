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
    const order = url.searchParams.get("order") === "desc" ? "desc" : "asc";
    const q = (url.searchParams.get("q") || "").trim();
    const status = (url.searchParams.get("status") || "").trim();

    const task = await prisma.evalTask.findFirst({ where: { id, userId: session.uid } });
    if (!task) return fail("任务不存在", 404);

    const where: Prisma.EvalResultWhereInput = { taskId: id };
    if (status && status !== "all") {
      where.status = status;
    }
    if (q) {
      const rowIndex = Number(q);
      where.AND = [
        {
          OR: [
            Number.isFinite(rowIndex) ? { rowIndex } : undefined,
            { status: { contains: q } },
            { inputData: { contains: q } },
            { requestPayload: { contains: q } },
            { outputs: { contains: q } },
            { errorType: { contains: q } },
            { errorMessage: { contains: q } },
            { endReason: { contains: q } },
            { ruleHit: { contains: q } },
          ].filter(Boolean) as Prisma.EvalResultWhereInput[],
        },
      ];
    }

    const [total, rows, ttftAgg] = await Promise.all([
      prisma.evalResult.count({ where }),
      prisma.evalResult.findMany({
        where,
        orderBy: { rowIndex: order },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.evalResult.aggregate({
        where: { taskId: id, ttftMs: { not: null } },
        _avg: { ttftMs: true },
      }),
    ]);

    return ok({
      total,
      page,
      pageSize,
      avgTtftMs: ttftAgg._avg.ttftMs ?? null,
      rows: rows.map((row) => ({
        ...row,
        inputData: parseJson(row.inputData, {}),
        requestPayload: parseJson(row.requestPayload, {}),
        outputs: parseJson(row.outputs, {}),
        rawTrace: parseJson(row.rawTrace, []),
      })),
    });
  } catch {
    return fail("查询失败", 500);
  }
}
