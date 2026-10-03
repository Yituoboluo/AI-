import pLimit from "p-limit";
import { prisma } from "@/lib/prisma";
import { buildEvaluationContext, renderEvaluationPrompt } from "@/lib/eval-template";
import { evaluateByLlm } from "@/lib/llm-eval";
import { parseJson, stringifyJson } from "@/lib/json";
import { notifyDingTalkMarkdown } from "@/lib/dingtalk";

function classifyError(error: unknown): { type: string; message: string } {
  if (error instanceof Error) {
    if (error.message.includes("timeout")) return { type: "TIMEOUT", message: error.message };
    if (error.message.includes("401")) return { type: "AUTH_ERROR", message: error.message };
    if (error.message.includes("429")) return { type: "RATE_LIMIT", message: error.message };
    if (error.message.includes("JSON")) return { type: "PARSE_ERROR", message: error.message };
    return { type: "UNKNOWN", message: error.message };
  }
  return { type: "UNKNOWN", message: String(error) };
}

async function refreshEvaluationTaskMetrics(taskId: string) {
  const results = await prisma.evaluationResult.findMany({
    where: { evaluationTaskId: taskId, status: "success", score: { not: null } },
    select: { score: true },
  });
  const avgScore = results.length
    ? results.reduce((sum, item) => sum + (item.score ?? 0), 0) / results.length
    : null;
  const passedCount = await prisma.evaluationResult.count({ where: { evaluationTaskId: taskId, status: "success", passed: true } });
  const failedCount = await prisma.evaluationResult.count({ where: { evaluationTaskId: taskId, status: "failed" } });

  await prisma.evaluationTask.update({
    where: { id: taskId },
    data: {
      avgScore,
      endedAt: new Date(),
    },
  });
  return { avgScore, passedCount, failedCount, evaluatedCount: results.length };
}

export async function runEvaluationTask(taskId: string) {
  const task = await prisma.evaluationTask.findUnique({
    where: { id: taskId },
    include: {
      evaluator: { include: { providerConfig: true } },
      sourceTask: {
        include: {
          dataset: true,
          profile: true,
          results: {
            orderBy: { rowIndex: "asc" },
          },
        },
      },
    },
  });
  if (!task) return;

  await prisma.evaluationTask.update({
    where: { id: taskId },
    data: { status: "running", startedAt: new Date() },
  });

  const sourceResults = task.sourceTask.results;
  const runnableResults = sourceResults.filter((item) => item.status === "success" || item.status === "warning");
  const skippedResults = sourceResults.filter((item) => item.status !== "success" && item.status !== "warning");

  if (skippedResults.length > 0) {
    await prisma.evaluationResult.createMany({
      data: skippedResults.map((item) => ({
        evaluationTaskId: task.id,
        sourceResultId: item.id,
        rowIndex: item.rowIndex,
        status: "skipped",
        reason: "来源结果非 success/warning，已跳过",
        promptSnapshot: "",
      })),
    });

    await prisma.evaluationTask.update({
      where: { id: task.id },
      data: { skippedRows: { increment: skippedResults.length } },
    });
  }

  const limit = pLimit(5);

  await Promise.all(
    runnableResults.map((item) =>
      limit(async () => {
        let latest = await prisma.evaluationTask.findUnique({ where: { id: task.id }, select: { status: true } });
        if (!latest || latest.status === "stopped") return;

        while (latest.status === "paused") {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          latest = await prisma.evaluationTask.findUnique({ where: { id: task.id }, select: { status: true } });
          if (!latest || latest.status === "stopped") return;
        }

        const variables = buildEvaluationContext(item);
        const userPrompt = renderEvaluationPrompt(task.evaluator.userPromptTemplate, variables);
        const promptSnapshot = serializePromptSnapshot({
          systemPrompt: task.evaluator.systemPrompt,
          userPrompt,
        });

        try {
          const response = await evaluateByLlm({
            baseUrl: task.evaluator.providerConfig.baseUrl,
            apiKey: task.evaluator.providerConfig.apiKeyEncrypted,
            model: task.evaluator.model,
            systemPrompt: task.evaluator.systemPrompt,
            userPrompt,
            thinkingEnabled: task.evaluator.thinkingEnabled,
          });

          const scoreValid = response.score >= task.evaluator.scoreMin && response.score <= task.evaluator.scoreMax;
          if (!scoreValid) {
            throw new Error(`SCORE_OUT_OF_RANGE: ${response.score}`);
          }

          await prisma.evaluationResult.create({
            data: {
              evaluationTaskId: task.id,
              sourceResultId: item.id,
              rowIndex: item.rowIndex,
              score: response.score,
              passed: response.passed,
              reason: response.reason,
              status: "success",
              promptSnapshot,
              rawResponse: response.rawResponse,
            },
          });

          await prisma.evaluationTask.update({
            where: { id: task.id },
            data: { successRows: { increment: 1 } },
          });
        } catch (error) {
          const classified = classifyError(error);
          await prisma.evaluationResult.create({
            data: {
              evaluationTaskId: task.id,
              sourceResultId: item.id,
              rowIndex: item.rowIndex,
              status: "failed",
              errorType: classified.type,
              errorMessage: classified.message,
              promptSnapshot,
            },
          });

          await prisma.evaluationTask.update({
            where: { id: task.id },
            data: { failedRows: { increment: 1 } },
          });
        }
      }),
    ),
  );

  const finishedTask = await prisma.evaluationTask.findUnique({ where: { id: task.id }, select: { status: true } });
  const finalStatus = finishedTask?.status === "stopped" ? "stopped" : "completed";
  await prisma.evaluationTask.update({
    where: { id: task.id },
    data: {
      status: finalStatus,
    },
  });
  const metrics = await refreshEvaluationTaskMetrics(task.id);
  if (finalStatus === "completed" && task.notifyDingTalk) {
    const total = sourceResults.length;
    const passRate = metrics.evaluatedCount ? ((metrics.passedCount / metrics.evaluatedCount) * 100).toFixed(1) : "0.0";
    const toolCounts = new Map<string, number>();
    for (const sourceResult of sourceResults) {
      const input = parseJson<Record<string, unknown>>(sourceResult.inputData, {});
      const reference = typeof input.reference_output === "string" ? parseJson<Record<string, unknown>>(input.reference_output, {}) : {};
      const tools = Array.isArray(reference.tools) ? reference.tools : [];
      const names = new Set<string>();
      for (const tool of tools) {
        if (!tool || typeof tool !== "object") continue;
        const values = (tool as Record<string, unknown>).names;
        if (Array.isArray(values)) values.filter((name): name is string => typeof name === "string").forEach((name) => names.add(name));
      }
      names.forEach((name) => toolCounts.set(name, (toolCounts.get(name) ?? 0) + 1));
    }
    const toolLabels: Record<string, string> = {
      payment: "支付",
      wechat_pay: "微信支付",
      control_calendar: "日程",
      control_memo: "备忘",
      navigation: "导航",
      search_around: "附近搜索",
      cut_agent: "天气",
      take_photo: "拍照识别",
      control_volume: "音量",
      control_brightness: "亮度",
      phone_call: "电话",
      record_audio: "录音",
      record_video: "录像",
      voice_wake_up: "语音唤醒",
      zoom_map: "地图缩放",
      calculate_relative_time: "相对时间",
      doubao_search: "豆包搜索",
      jd: "同款购",
      next_holiday: "节假日查询",
    };
    const toolEntries = [...toolCounts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, count]) => `${toolLabels[name] ?? name}（${count}）`);
    const toolSummaryLines = Array.from({ length: Math.ceil(toolEntries.length / 5) }, (_, index) =>
      `- ${toolEntries.slice(index * 5, index * 5 + 5).join("、")}`,
    ).join("\n");
    const datasetName = task.sourceTask.dataset.name.match(/^每日冒烟评测集_\d{4}/)?.[0] ?? task.sourceTask.dataset.name;
    const environment = task.sourceTask.profile.name;
    const failedAssertions = metrics.evaluatedCount - metrics.passedCount;
    const failedResults = await prisma.evaluationResult.findMany({
      where: { evaluationTaskId: task.id, status: "success", passed: false },
      orderBy: { rowIndex: "asc" },
      take: 5,
      include: { sourceResult: { select: { inputData: true } } },
    });
    const failureLines = failedResults.map((result) => {
      const input = parseJson<Record<string, unknown>>(result.sourceResult.inputData, {});
      const text = typeof input.Input === "string" ? input.Input : `第 ${result.rowIndex + 1} 条`;
      return `- 第 ${result.rowIndex + 1} 条：${text}（${result.reason || "未通过"}）`;
    });
    const allPassed = failedAssertions === 0 && metrics.failedCount === 0;
    const headline = allPassed ? "✅ 云端意图验证通过" : "⚠️ 云端意图验证发现问题";
    const conclusion = allPassed
      ? `本次在测试环境验证了 ${total} 条意图，覆盖 ${toolCounts.size} 类工具，云端意图识别和工具路由均正常。`
      : `本次在测试环境验证了 ${total} 条意图，覆盖 ${toolCounts.size} 类工具，仍有 ${failedAssertions + metrics.failedCount} 条需要关注。`;
    const failureSection =
      failedAssertions || metrics.failedCount
        ? `\n**问题摘要：**\n${failureLines.join("\n") || "- 存在评估异常，请查看控制台详情"}${failedAssertions > 5 ? `\n- 其余 ${failedAssertions - 5} 条请查看控制台` : ""}`
        : "\n**问题摘要：** 无";
    notifyDingTalkMarkdown(
      `${headline}｜${datasetName}`,
      `## ${headline}\n\n**一、测试信息**\n- 环境：${environment}\n- 数据集：${datasetName}\n- 评估器：${task.evaluator.name}\n\n**二、评测范围**\n${conclusion}\n- 意图数量：${total} 条\n- 覆盖工具：${toolCounts.size} 类\n${toolSummaryLines || "- 无"}\n\n**三、评测结果**\n- 评分：${metrics.avgScore === null ? "-" : `${metrics.avgScore.toFixed(1)} / 100`}\n- 通过率：${passRate}%\n- 通过：${metrics.passedCount} / ${metrics.evaluatedCount}\n- 未通过：${failedAssertions}\n- 评估异常：${metrics.failedCount}\n- 执行完成：${metrics.evaluatedCount} / ${total}${failureSection}\n\n> 详细结果：评测控制台 → 评估结果`,
    ).catch(console.error);
  }
}

export function getMaskedApiKey(apiKey: string) {
  if (!apiKey) return "";
  const visiblePrefix = apiKey.slice(0, Math.min(6, apiKey.length));
  return `${visiblePrefix}********`;
}

export function serializePromptSnapshot(payload: { systemPrompt: string; userPrompt: string }) {
  return stringifyJson(payload);
}
