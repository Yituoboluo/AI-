import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { getMaskedApiKey } from "@/lib/evaluation";
import { fail, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  name: z.string().min(1),
  providerType: z.literal("openai_compatible").default("openai_compatible"),
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  defaultModel: z.string().min(1),
  enabled: z.boolean().default(true),
});

export async function GET() {
  try {
    const session = await requireSession();
    const list = await prisma.llmProviderConfig.findMany({
      where: { userId: session.uid },
      orderBy: { createdAt: "desc" },
    });
    return ok(
      list.map((item) => ({
        ...item,
        apiKeyMasked: getMaskedApiKey(item.apiKeyEncrypted),
      })),
    );
  } catch {
    return fail("未登录", 401);
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) return fail("模型配置参数不合法", 400);

    const provider = await prisma.llmProviderConfig.create({
      data: {
        userId: session.uid,
        name: parsed.data.name,
        providerType: parsed.data.providerType,
        baseUrl: parsed.data.baseUrl,
        apiKeyEncrypted: parsed.data.apiKey,
        defaultModel: parsed.data.defaultModel,
        enabled: parsed.data.enabled,
      },
    });

    return ok({
      ...provider,
      apiKeyMasked: getMaskedApiKey(provider.apiKeyEncrypted),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return fail("未登录", 401);
    return fail("创建模型配置失败", 500);
  }
}
