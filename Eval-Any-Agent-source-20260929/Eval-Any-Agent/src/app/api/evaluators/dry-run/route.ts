import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { buildEvaluationContext, renderEvaluationPrompt } from "@/lib/eval-template";
import { evaluateByLlm } from "@/lib/llm-eval";
import { fail, ok } from "@/lib/http";
import { parseJson } from "@/lib/json";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  providerConfigId: z.string().min(1),
  model: z.string().min(1),
  systemPrompt: z.string().min(1),
  userPromptTemplate: z.string().min(1),
  thinkingEnabled: z.boolean().default(false),
  sourceResultId: z.string().optional(),
  sourceTaskId: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) return fail("评估预览参数不合法", 400);

    const provider = await prisma.llmProviderConfig.findFirst({
      where: { id: parsed.data.providerConfigId, userId: session.uid },
    });
    if (!provider) return fail("模型配置不存在", 404);

    let sourceResult = null;
    if (parsed.data.sourceResultId) {
      sourceResult = await prisma.evalResult.findFirst({
        where: {
          id: parsed.data.sourceResultId,
          task: { userId: session.uid },
        },
      });
    } else if (parsed.data.sourceTaskId) {
      sourceResult = await prisma.evalResult.findFirst({
        where: {
          taskId: parsed.data.sourceTaskId,
          task: { userId: session.uid },
        },
        orderBy: { rowIndex: "asc" },
      });
    }
    if (!sourceResult) return fail("未找到可用于预览的任务结果", 404);

    const variables = buildEvaluationContext(sourceResult);
    const userPrompt = renderEvaluationPrompt(parsed.data.userPromptTemplate, variables);
    const response = await evaluateByLlm({
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKeyEncrypted,
      model: parsed.data.model,
      systemPrompt: parsed.data.systemPrompt,
      userPrompt,
      thinkingEnabled: parsed.data.thinkingEnabled,
      timeoutMs: 10000,
    });

    return ok({
      systemPrompt: parsed.data.systemPrompt,
      userPrompt,
      result: response,
      preview: {
        input: parseJson(sourceResult.inputData, {}),
        outputs: parseJson(sourceResult.outputs, {}),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "评估预览失败";
    return fail(message, 500);
  }
}
