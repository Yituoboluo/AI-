import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { runEvaluationTask } from "@/lib/evaluation";
import { fail, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  sourceTaskId: z.string().min(1),
  evaluatorIds: z.array(z.string().min(1)).min(1),
  notifyDingTalk: z.boolean().default(false),
});

export async function GET() {
  try {
    const session = await requireSession();
    const list = await prisma.evaluationTask.findMany({
      where: { userId: session.uid },
      orderBy: { createdAt: "desc" },
      include: {
        evaluator: { select: { id: true, name: true } },
        sourceTask: {
          select: {
            id: true,
            dataset: { select: { name: true } },
            profile: { select: { name: true } },
          },
        },
      },
    });
    return ok(list);
  } catch {
    return fail("未登录", 401);
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) return fail("参数不合法", 400);

    const sourceTask = await prisma.evalTask.findFirst({
      where: { id: parsed.data.sourceTaskId, userId: session.uid },
      include: { results: true },
    });
    if (!sourceTask) return fail("来源任务不存在", 404);

    const evaluators = await prisma.evaluator.findMany({
      where: { id: { in: parsed.data.evaluatorIds }, userId: session.uid, enabled: true },
    });
    if (evaluators.length === 0) return fail("未找到可用评估器", 404);

    const created = [];
    for (const evaluator of evaluators) {
      const task = await prisma.evaluationTask.create({
        data: {
          userId: session.uid,
          sourceTaskId: sourceTask.id,
          evaluatorId: evaluator.id,
          status: "queued",
          totalRows: sourceTask.results.length,
          notifyDingTalk: parsed.data.notifyDingTalk,
        },
        include: {
          evaluator: { select: { id: true, name: true } },
          sourceTask: {
            select: {
              id: true,
              dataset: { select: { name: true } },
              profile: { select: { name: true } },
            },
          },
        },
      });
      created.push(task);

      setTimeout(() => {
        runEvaluationTask(task.id).catch(console.error);
      }, 10);
    }

    return ok(created);
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return fail("未登录", 401);
    return fail("创建评估任务失败", 500);
  }
}
