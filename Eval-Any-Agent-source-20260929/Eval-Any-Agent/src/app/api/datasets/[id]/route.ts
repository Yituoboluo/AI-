import { requireSession } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;

    const target = await prisma.dataset.findFirst({ where: { id, userId: session.uid } });
    if (!target) return fail("数据集不存在", 404);

    await prisma.dataset.delete({ where: { id } });
    return ok({ id });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return fail("未登录", 401);
    return fail("删除失败", 500);
  }
}
