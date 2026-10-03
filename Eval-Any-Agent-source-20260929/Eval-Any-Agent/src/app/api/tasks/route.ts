import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { runEvalTask } from "@/lib/execution";

const schema = z.object({
  datasetId: z.string().min(1),
  profileId: z.string().min(1),
  concurrency: z.number().int().min(1).max(50).default(20),
  timeoutMs: z.number().int().positive().default(60000),
  retryCount: z.number().int().min(0).max(5).default(2),
  conversationIdMode: z.enum(["preserve", "per_row", "every_n_rows"]).default("preserve"),
  conversationIdEvery: z.number().int().min(1).max(100000).default(1),
});

export async function GET() {
  try {
    const session = await requireSession();
    const list = await prisma.evalTask.findMany({
      where: { userId: session.uid },
      orderBy: { createdAt: "desc" },
      include: {
        profile: { select: { name: true } },
        dataset: { select: { name: true } },
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

    const dataset = await prisma.dataset.findFirst({ where: { id: parsed.data.datasetId, userId: session.uid } });
    if (!dataset) return fail("数据集不存在", 404);

    const profile = await prisma.mappingProfile.findFirst({
      where: { id: parsed.data.profileId, userId: session.uid },
    });
    if (!profile) return fail("配置不存在", 404);

    const task = await prisma.evalTask.create({
      data: {
        userId: session.uid,
        datasetId: dataset.id,
        profileId: profile.id,
        status: "queued",
        concurrency: parsed.data.concurrency,
        timeoutMs: parsed.data.timeoutMs,
        retryCount: parsed.data.retryCount,
        conversationIdMode: parsed.data.conversationIdMode,
        conversationIdEvery: parsed.data.conversationIdEvery,
        totalRows: dataset.rowCount,
      },
    });

    setTimeout(() => {
      runEvalTask(task.id).catch(console.error);
    }, 10);

    return ok(task);
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return fail("未登录", 401);
    return fail("创建任务失败", 500);
  }
}
