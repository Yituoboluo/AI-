import pLimit from "p-limit";
import { parseJson, stringifyJson } from "@/lib/json";
import { prisma } from "@/lib/prisma";
import { buildVariables, renderHeaderTemplate, renderRequestTemplate } from "@/lib/template";
import { runStreamRequest } from "@/lib/stream";
import type { DoneRule, ExtractRule, InputBinding, StreamProtocol } from "@/lib/types";

function classifyError(error: unknown): { type: string; message: string } {
  if (error instanceof Error) {
    if (error.message === "IDLE_TIMEOUT") return { type: "IDLE_TIMEOUT", message: error.message };
    if (error.message.includes("REQUEST_TIMEOUT")) return { type: "TIMEOUT", message: error.message };
    if (error.message.startsWith("HTTP_")) return { type: "HTTP_ERROR", message: error.message };
    return { type: "UNKNOWN", message: error.message };
  }
  return { type: "UNKNOWN", message: String(error) };
}

export async function runEvalTask(taskId: string) {
  const task = await prisma.evalTask.findUnique({
    where: { id: taskId },
    include: { profile: true, dataset: true },
  });
  if (!task) return;

  await prisma.evalTask.update({
    where: { id: taskId },
    data: { status: "running", startedAt: new Date() },
  });

  const rows = parseJson<Record<string, unknown>[]>(task.dataset.rows, []);
  const extractRules = parseJson<ExtractRule[]>(task.profile.extractRules, []);
  const inputBindings = parseJson<InputBinding[]>(task.profile.inputBindings, []);
  const doneRules = parseJson<DoneRule[]>(task.profile.doneRules, []);
  const headerTemplate = parseJson<Record<string, string>>(task.profile.headers, {});

  const limit = pLimit(task.concurrency);

  await Promise.all(
    rows.map((row, rowIndex) =>
      limit(async () => {
        let latest = await prisma.evalTask.findUnique({ where: { id: taskId }, select: { status: true } });
        if (!latest || latest.status === "stopped") return;

        while (latest.status === "paused") {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          latest = await prisma.evalTask.findUnique({ where: { id: taskId }, select: { status: true } });
          if (!latest || latest.status === "stopped") return;
        }

        const variables = buildVariables(row, inputBindings);
        if (task.conversationIdMode !== "preserve") {
          const group = task.conversationIdMode === "every_n_rows" ? Math.floor(rowIndex / task.conversationIdEvery) : rowIndex;
          variables.conversation_id = `${taskId}-${group}`;
        }
        const payload = renderRequestTemplate(task.profile.requestTemplate, variables);
        const headers = renderHeaderTemplate(headerTemplate, variables);

        let attempt = 0;
        let lastError: unknown = null;

        while (attempt <= task.retryCount) {
          try {
            const result = await runStreamRequest({
              url: task.profile.upstreamUrl,
              method: task.profile.method,
              headers,
              payload,
              protocol: task.profile.streamProtocol as StreamProtocol,
              doneStrategy: task.profile.doneStrategy as "auto" | "manual",
              doneRules,
              doneRequired: task.profile.doneRequired,
              timeoutMs: task.timeoutMs,
              idleTimeoutMs: task.profile.idleTimeoutMs,
              extractRules,
            });

            await prisma.evalResult.create({
              data: {
                taskId,
                rowIndex,
                inputData: stringifyJson(row),
                requestPayload: stringifyJson(payload),
                outputs: stringifyJson(result.outputs),
                ttftMs: result.ttftMs,
                latencyMs: result.latencyMs,
                status: result.endReason === "END_SIGNAL_MISSING" ? "warning" : "success",
                endReason: result.endReason,
                ruleHit: result.ruleHit,
                rawTrace: stringifyJson(result.rawTrace),
              },
            });

            await prisma.evalTask.update({
              where: { id: taskId },
              data: { successRows: { increment: 1 } },
            });
            return;
          } catch (error) {
            lastError = error;
            attempt += 1;
            if (attempt <= task.retryCount) {
              await new Promise((resolve) => setTimeout(resolve, attempt * 300));
            }
          }
        }

        const classified = classifyError(lastError);
        await prisma.evalResult.create({
          data: {
            taskId,
            rowIndex,
            inputData: stringifyJson(row),
            requestPayload: stringifyJson(payload),
            outputs: stringifyJson({}),
            status: "failed",
            errorType: classified.type,
            errorMessage: classified.message,
            endReason: "failed",
          },
        });

        await prisma.evalTask.update({
          where: { id: taskId },
          data: { failedRows: { increment: 1 } },
        });
      }),
    ),
  );

  const finishedTask = await prisma.evalTask.findUnique({ where: { id: taskId }, select: { status: true, totalRows: true, successRows: true, failedRows: true, startedAt: true } });
  const status = finishedTask?.status === "stopped" ? "stopped" : "completed";
  await prisma.evalTask.update({
    where: { id: taskId },
    data: {
      status,
      endedAt: new Date(),
    },
  });
}
