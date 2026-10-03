import { requireSession } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { parseJson } from "@/lib/json";
import { prisma } from "@/lib/prisma";
import { buildVariables, renderHeaderTemplate, renderRequestTemplate } from "@/lib/template";
import { runStreamRequest } from "@/lib/stream";
import type { DoneRule, ExtractRule, InputBinding, StreamProtocol } from "@/lib/types";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const datasetId = typeof body.datasetId === "string" ? body.datasetId : "";

    const profile = await prisma.mappingProfile.findFirst({ where: { id, userId: session.uid } });
    if (!profile) return fail("配置不存在", 404);
    if (!datasetId) return fail("Dry Run 需要选择数据集", 400);

    const dataset = await prisma.dataset.findFirst({
      where: { id: datasetId, userId: session.uid },
      select: { rows: true },
    });
    if (!dataset) return fail("数据集不存在", 404);

    const rows = parseJson<Record<string, unknown>[]>(dataset.rows, []);
    const row = body.row && typeof body.row === "object" ? body.row : rows[0];
    if (!row) return fail("数据集为空", 400);

    const variables = buildVariables(row, parseJson<InputBinding[]>(profile.inputBindings, []));
    const payload = renderRequestTemplate(profile.requestTemplate, variables);
    const renderedHeaders = renderHeaderTemplate(
      parseJson<Record<string, string>>(profile.headers, {}),
      variables,
    );

    const result = await runStreamRequest({
      url: profile.upstreamUrl,
      method: profile.method,
      headers: renderedHeaders,
      payload,
      protocol: profile.streamProtocol as StreamProtocol,
      doneStrategy: profile.doneStrategy as "auto" | "manual",
      doneRules: parseJson<DoneRule[]>(profile.doneRules, []),
      doneRequired: profile.doneRequired,
      timeoutMs: profile.timeoutMs,
      idleTimeoutMs: profile.idleTimeoutMs,
      extractRules: parseJson<ExtractRule[]>(profile.extractRules, []),
    });

    return ok({
      requestPayload: payload,
      outputs: result.outputs,
      ttftMs: result.ttftMs,
      latencyMs: result.latencyMs,
      endReason: result.endReason,
      ruleHit: result.ruleHit,
      tracePreview: result.rawTrace.slice(0, 20),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return fail("未登录", 401);
    return fail(error instanceof Error ? error.message : "试跑失败", 500);
  }
}
