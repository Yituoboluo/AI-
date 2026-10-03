import Mustache from "mustache";
import { parseJson } from "@/lib/json";

export type EvaluationTemplateContext = {
  input: Record<string, unknown>;
  outputs: Record<string, unknown>;
  outputs_json: string;
  raw_trace: string;
  tool_calls_json: string;
  result: {
    status: string;
    ttftMs: number | null;
    latencyMs: number | null;
    errorType: string | null;
    errorMessage: string | null;
    endReason: string | null;
    ruleHit: string | null;
  };
  reference_output: string;
};

function normalizeToolCalls(rawTrace: string) {
  const trace = parseJson<unknown[]>(rawTrace, []);
  return trace.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const traceItem = item as Record<string, unknown>;
    const message = (item as Record<string, unknown>).message;
    if (!message || typeof message !== "object") return [];
    const metadata = (message as Record<string, unknown>).metadata;
    if (!metadata || typeof metadata !== "object") return [];
    const meta = metadata as Record<string, unknown>;
    const name = typeof meta.name === "string" ? meta.name : "";
    if (!name) return [];

    // A single tool invocation is streamed as multiple events. The first
    // `tool_calling` event intentionally has an empty input, while the final
    // `tool_call_finish` event contains the actual input/output. Only expose
    // completed events to the evaluator, otherwise an empty processing event
    // can be mistaken for a second invalid tool call.
    const eventStatus = typeof traceItem.status === "string" ? traceItem.status : "";
    const toolStatus = typeof meta.status === "string" ? meta.status : "";
    const isCompleted =
      eventStatus === "tool_call_finish" ||
      ["success", "completed", "finish", "finished"].includes(toolStatus);
    if (!isCompleted) return [];

    const input = typeof meta.input === "string" ? parseJson<Record<string, unknown>>(meta.input, {}) : {};
    let outputParams: Record<string, unknown> = {};
    if (typeof meta.output === "string") {
      const output = parseJson<Record<string, unknown>>(meta.output, {});
      outputParams = (((output.data ?? {}) as Record<string, unknown>).params ?? {}) as Record<string, unknown>;
    } else if (meta.output && typeof meta.output === "object") {
      const output = meta.output as Record<string, unknown>;
      outputParams = ((((output.data ?? {}) as Record<string, unknown>).params ?? {}) as Record<string, unknown>);
    }
    return [{ name, params: { ...outputParams, ...input }, status: meta.status ?? "" }];
  });
}

export function buildEvaluationContext(sourceResult: {
  inputData: string;
  outputs: string;
  status: string;
  ttftMs: number | null;
  latencyMs: number | null;
  errorType: string | null;
  errorMessage: string | null;
  endReason: string | null;
  ruleHit: string | null;
  rawTrace: string | null;
}) {
  const input = parseJson<Record<string, unknown>>(sourceResult.inputData, {});
  const outputs = parseJson<Record<string, unknown>>(sourceResult.outputs, {});
  const rawTrace = sourceResult.rawTrace ?? "[]";
  const toolCalls = normalizeToolCalls(rawTrace);
  const referenceOutput = input.reference_output;

  const context: EvaluationTemplateContext = {
    input,
    outputs,
    outputs_json: JSON.stringify(outputs, null, 2),
    raw_trace: rawTrace,
    tool_calls_json: JSON.stringify(toolCalls, null, 2),
    result: {
      status: sourceResult.status,
      ttftMs: sourceResult.ttftMs,
      latencyMs: sourceResult.latencyMs,
      errorType: sourceResult.errorType,
      errorMessage: sourceResult.errorMessage,
      endReason: sourceResult.endReason,
      ruleHit: sourceResult.ruleHit,
    },
    reference_output: typeof referenceOutput === "string" ? referenceOutput : "",
  };

  return {
    ...input,
    ...context,
  };
}

export function renderEvaluationPrompt(template: string, variables: Record<string, unknown>) {
  return Mustache.render(template, variables);
}
