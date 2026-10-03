import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  name: z.string().min(1),
  providerConfigId: z.string().min(1),
  model: z.string().min(1),
  systemPrompt: z.string().min(1),
  userPromptTemplate: z.string().min(1),
  thinkingEnabled: z.boolean().default(false),
  scoreMin: z.number(),
  scoreMax: z.number(),
  passThreshold: z.number(),
  enabled: z.boolean().default(true),
});

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) return fail("评估器参数不合法", 400);
    if (parsed.data.scoreMax < parsed.data.scoreMin) return fail("评分区间不合法", 400);

    const current = await prisma.evaluator.findFirst({ where: { id, userId: session.uid } });
    if (!current) return fail("评估器不存在", 404);

    const provider = await prisma.llmProviderConfig.findFirst({
      where: { id: parsed.data.providerConfigId, userId: session.uid },
    });
    if (!provider) return fail("模型配置不存在", 404);

    const evaluator = await prisma.evaluator.update({
      where: { id },
      data: parsed.data,
      include: {
        providerConfig: {
          select: { id: true, name: true, baseUrl: true, defaultModel: true },
        },
      },
    });
    return ok(evaluator);
  } catch {
    return fail("更新评估器失败", 500);
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const current = await prisma.evaluator.findFirst({ where: { id, userId: session.uid } });
    if (!current) return fail("评估器不存在", 404);
    await prisma.evaluator.delete({ where: { id } });
    return ok({ id });
  } catch {
    return fail("删除评估器失败", 500);
  }
}
