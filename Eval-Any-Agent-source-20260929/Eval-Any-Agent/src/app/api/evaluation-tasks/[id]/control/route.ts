import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  action: z.enum(["pause", "resume", "stop"]),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) return fail("参数不合法", 400);

    const task = await prisma.evaluationTask.findFirst({
      where: { id, userId: session.uid },
    });
    if (!task) return fail("评估任务不存在", 404);

    const statusMap = {
      pause: "paused",
      resume: "running",
      stop: "stopped",
    } as const;

    await prisma.evaluationTask.update({
      where: { id },
      data: { status: statusMap[parsed.data.action] },
    });
    return ok({ id, status: statusMap[parsed.data.action] });
  } catch {
    return fail("操作失败", 500);
  }
}
