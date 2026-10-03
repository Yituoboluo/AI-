import { requireSession } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const task = await prisma.evaluationTask.findFirst({
      where: { id, userId: session.uid },
      include: {
        evaluator: true,
        sourceTask: {
          include: {
            dataset: true,
            profile: true,
          },
        },
      },
    });
    if (!task) return fail("评估任务不存在", 404);
    return ok(task);
  } catch {
    return fail("未登录", 401);
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const task = await prisma.evaluationTask.findFirst({
      where: { id, userId: session.uid },
    });
    if (!task) return fail("评估任务不存在", 404);
    await prisma.evaluationTask.delete({ where: { id } });
    return ok({ id });
  } catch {
    return fail("删除评估任务失败", 500);
  }
}
