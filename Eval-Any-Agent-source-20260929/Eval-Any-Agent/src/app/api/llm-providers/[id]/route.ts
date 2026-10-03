import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { getMaskedApiKey } from "@/lib/evaluation";
import { fail, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  name: z.string().min(1),
  providerType: z.literal("openai_compatible").default("openai_compatible"),
  baseUrl: z.string().url(),
  apiKey: z.string().optional(),
  defaultModel: z.string().min(1),
  enabled: z.boolean().default(true),
});

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) return fail("模型配置参数不合法", 400);

    const current = await prisma.llmProviderConfig.findFirst({ where: { id, userId: session.uid } });
    if (!current) return fail("模型配置不存在", 404);

    const provider = await prisma.llmProviderConfig.update({
      where: { id },
      data: {
        name: parsed.data.name,
        providerType: parsed.data.providerType,
        baseUrl: parsed.data.baseUrl,
        apiKeyEncrypted: parsed.data.apiKey || current.apiKeyEncrypted,
        defaultModel: parsed.data.defaultModel,
        enabled: parsed.data.enabled,
      },
    });

    return ok({
      ...provider,
      apiKeyMasked: getMaskedApiKey(provider.apiKeyEncrypted),
    });
  } catch {
    return fail("更新模型配置失败", 500);
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const current = await prisma.llmProviderConfig.findFirst({ where: { id, userId: session.uid } });
    if (!current) return fail("模型配置不存在", 404);
    await prisma.llmProviderConfig.delete({ where: { id } });
    return ok({ id });
  } catch {
    return fail("删除模型配置失败", 500);
  }
}
