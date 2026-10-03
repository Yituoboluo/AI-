import OpenAI from "openai";
import { requireSession } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const provider = await prisma.llmProviderConfig.findFirst({
      where: { id, userId: session.uid },
    });
    if (!provider) return fail("模型配置不存在", 404);

    const client = new OpenAI({
      apiKey: provider.apiKeyEncrypted,
      baseURL: provider.baseUrl,
      timeout: 15000,
    });

    const startedAt = Date.now();
    await client.chat.completions.create({
      model: provider.defaultModel,
      temperature: 0,
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    });

    return ok({
      healthy: true,
      latencyMs: Date.now() - startedAt,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return fail("未登录", 401);
    const message = error instanceof Error && error.message ? error.message : "模型连通性检测失败";
    return ok(
      {
        healthy: false,
        message,
      },
      { status: 200 },
    );
  }
}
