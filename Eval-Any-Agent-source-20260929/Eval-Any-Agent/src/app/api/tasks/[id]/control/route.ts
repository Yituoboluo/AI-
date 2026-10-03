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

    const current = await prisma.evalTask.findFirst({ where: { id, userId: session.uid } });
    if (!current) return fail("任务不存在", 404);

    const statusMap = {
      pause: "paused",
      resume: "running",
      stop: "stopped",
    } as const;

    await prisma.evalTask.update({ where: { id }, data: { status: statusMap[parsed.data.action] } });
    return ok({ id, status: statusMap[parsed.data.action] });
  } catch {
    return fail("操作失败", 500);
  }
}
