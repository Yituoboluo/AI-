import { requireSession } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const task = await prisma.evalTask.findFirst({
      where: { id, userId: session.uid },
      include: { profile: true, dataset: true },
    });
    if (!task) return fail("任务不存在", 404);
    return ok(task);
  } catch {
    return fail("未登录", 401);
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const target = await prisma.evalTask.findFirst({ where: { id, userId: session.uid } });
    if (!target) return fail("任务不存在", 404);
    await prisma.evalTask.delete({ where: { id } });
    return ok({ id });
  } catch {
    return fail("删除失败", 500);
  }
}
