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

export async function GET() {
  try {
    const session = await requireSession();
    const list = await prisma.evaluator.findMany({
      where: { userId: session.uid },
      orderBy: { createdAt: "desc" },
      include: {
        providerConfig: {
          select: { id: true, name: true, baseUrl: true, defaultModel: true },
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
    if (!parsed.success) return fail("评估器参数不合法", 400);
    if (parsed.data.scoreMax < parsed.data.scoreMin) return fail("评分区间不合法", 400);

    const provider = await prisma.llmProviderConfig.findFirst({
      where: { id: parsed.data.providerConfigId, userId: session.uid },
    });
    if (!provider) return fail("模型配置不存在", 404);

    const evaluator = await prisma.evaluator.create({
      data: {
        userId: session.uid,
        providerConfigId: parsed.data.providerConfigId,
        name: parsed.data.name,
        model: parsed.data.model,
        systemPrompt: parsed.data.systemPrompt,
        userPromptTemplate: parsed.data.userPromptTemplate,
        thinkingEnabled: parsed.data.thinkingEnabled,
        scoreMin: parsed.data.scoreMin,
        scoreMax: parsed.data.scoreMax,
        passThreshold: parsed.data.passThreshold,
        enabled: parsed.data.enabled,
      },
      include: {
        providerConfig: {
          select: { id: true, name: true, baseUrl: true, defaultModel: true },
        },
      },
    });
    return ok(evaluator);
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return fail("未登录", 401);
    return fail("创建评估器失败", 500);
  }
}
