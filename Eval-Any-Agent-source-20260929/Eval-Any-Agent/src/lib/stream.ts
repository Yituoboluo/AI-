import { JSONPath } from "jsonpath-plus";
import type { DoneRule, DoneStrategy, ExtractRule, StreamProtocol } from "@/lib/types";

export type StreamRunInput = {
  url: string;
  method: string;
  headers: Record<string, string>;
  payload: unknown;
  protocol: StreamProtocol;
  doneStrategy: DoneStrategy;
  doneRules: DoneRule[];
  doneRequired: boolean;
  timeoutMs: number;
  idleTimeoutMs: number;
  extractRules: ExtractRule[];
};

export type StreamRunOutput = {
  outputs: Record<string, unknown>;
  ttftMs: number | null;
  latencyMs: number;
  endReason: string;
  ruleHit: string | null;
  rawTrace: unknown[];
};

function evaluateDoneRule(
  rule: DoneRule,
  context: { rawLine: string; parsedChunk: unknown; eventName: string | null },
): boolean {
  switch (rule.type) {
    case "sentinel_text":
      return context.rawLine.trim() === rule.value;
    case "json_path_equals": {
      if (!context.parsedChunk || typeof context.parsedChunk !== "object") return false;
      const values = JSONPath({ path: rule.path, json: context.parsedChunk }) as unknown[];
      return values.some((v: unknown) => String(v) === String(rule.equals));
    }
    case "event_name":
      return context.eventName === rule.value;
    case "connection_close":
      return false;
    case "max_idle_ms":
      return false;
    default:
      return false;
  }
}

function appendTextExtract(outputs: Record<string, unknown>, key: string, val: unknown) {
  const text = typeof val === "string" ? val : JSON.stringify(val);
  outputs[key] = `${outputs[key] ?? ""}${text ?? ""}`;
}

function appendJsonExtract(outputs: Record<string, unknown>, key: string, val: unknown) {
  if (!(key in outputs)) {
    outputs[key] = val;
    return;
  }

  const current = outputs[key];
  outputs[key] = Array.isArray(current) ? [...current, val] : [current, val];
}

function extractFromChunk(outputs: Record<string, unknown>, chunk: unknown, rules: ExtractRule[]) {
  for (const rule of rules) {
    if (!rule.key || !rule.path) continue;
    try {
      const jsonInput =
        chunk === null || ["string", "number", "boolean"].includes(typeof chunk)
          ? { value: chunk }
          : (chunk as object);
      const values = JSONPath({ path: rule.path, json: jsonInput }) as unknown[];
      if (!values || values.length === 0) continue;
      for (const value of values) {
        if (rule.mode === "json") appendJsonExtract(outputs, rule.key, value);
        else appendTextExtract(outputs, rule.key, value);
      }
    } catch {
      // Ignore invalid path runtime errors per rule.
    }
  }
}

function parsePayloadText(payloadText: string): unknown {
  if (payloadText === "[DONE]") return payloadText;
  try {
    return JSON.parse(payloadText);
  } catch {
    return { text: payloadText };
  }
}

async function readWithIdleTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  idleTimeoutMs: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (idleTimeoutMs <= 0) {
    return reader.read();
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("IDLE_TIMEOUT"));
    }, idleTimeoutMs);

    reader
      .read()
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

export async function runStreamRequest(input: StreamRunInput): Promise<StreamRunOutput> {
  const startedAt = Date.now();
  const outputs: Record<string, unknown> = {};
  const rawTrace: unknown[] = [];
  let ttftMs: number | null = null;
  let endReason = "connection_close";
  let ruleHit: string | null = null;
  let eventName: string | null = null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("REQUEST_TIMEOUT")), input.timeoutMs);
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let streamCompleted = false;

  try {
    const response = await fetch(input.url, {
      method: input.method,
      headers: {
        "Content-Type": "application/json",
        ...input.headers,
      },
      body: JSON.stringify(input.payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = (await response.text()).trim();
      throw new Error(`HTTP_${response.status}${detail ? `: ${detail.slice(0, 240)}` : ""}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const text = await response.text();
      const parsed = text ? parsePayloadText(text) : {};
      rawTrace.push(parsed);
      extractFromChunk(outputs, parsed, input.extractRules);
      return {
        outputs,
        ttftMs,
        latencyMs: Date.now() - startedAt,
        endReason: "single_response",
        ruleHit,
        rawTrace,
      };
    }

    if (!response.body) {
      const text = await response.text();
      const parsed = text ? parsePayloadText(text) : {};
      rawTrace.push(parsed);
      extractFromChunk(outputs, parsed, input.extractRules);
      return {
        outputs,
        ttftMs,
        latencyMs: Date.now() - startedAt,
        endReason: "single_response",
        ruleHit,
        rawTrace,
      };
    }

    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let done = false;

    const explicitRules = input.doneRules.filter((rule) => rule.type !== "connection_close" && rule.type !== "max_idle_ms");
    const idleRule = input.doneRules.find((rule) => rule.type === "max_idle_ms") as
      | { type: "max_idle_ms"; value: number }
      | undefined;

    const processPayloadText = (payloadText: string) => {
      if (!payloadText) return false;

      const parsedChunk = parsePayloadText(payloadText);
      rawTrace.push(parsedChunk);
      extractFromChunk(outputs, parsedChunk, input.extractRules);

      const hit = explicitRules.find((rule) =>
        evaluateDoneRule(rule, {
          rawLine: payloadText,
          parsedChunk,
          eventName,
        }),
      );

      if (hit) {
        endReason = hit.type;
        ruleHit = hit.type;
        return true;
      }

      if (payloadText === "[DONE]" && input.doneStrategy === "auto") {
        endReason = "sentinel_text";
        ruleHit = "auto:[DONE]";
        return true;
      }

      return false;
    };

    while (!done) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await readWithIdleTimeout(reader, idleRule?.value ?? input.idleTimeoutMs);
      } catch (error) {
        if (error instanceof Error && error.message === "IDLE_TIMEOUT") {
          endReason = "max_idle_ms";
          ruleHit = "max_idle_ms";
          break;
        }
        throw error;
      }

      if (result.done) {
        streamCompleted = true;
        break;
      }

      const chunkText = decoder.decode(result.value, { stream: true });
      if (!chunkText) continue;
      if (ttftMs === null) {
        ttftMs = Date.now() - startedAt;
      }

      buffer += chunkText;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const lineRaw of lines) {
        const line = lineRaw.trim();
        if (!line) continue;

        if (line.startsWith("event:")) {
          eventName = line.replace(/^event:\s*/, "").trim();
          continue;
        }

        let payloadText = line;
        if (line.startsWith("data:")) {
          payloadText = line.replace(/^data:\s*/, "");
        }

        if (processPayloadText(payloadText)) {
          done = true;
          break;
        }
      }
    }

    const remainingPayload = buffer.trim();
    if (!done && remainingPayload) {
      processPayloadText(remainingPayload);
    }

    if (!ruleHit && input.doneStrategy === "auto") {
      if (input.protocol === "sse" || input.protocol === "auto") {
        endReason = "connection_close";
      } else {
        endReason = "connection_close";
      }
    }

    if (!ruleHit && input.doneRequired) {
      endReason = "END_SIGNAL_MISSING";
    }

    return {
      outputs,
      ttftMs,
      latencyMs: Date.now() - startedAt,
      endReason,
      ruleHit,
      rawTrace,
    };
  } catch (error) {
    if (controller.signal.aborted) {
      const reason = controller.signal.reason;
      if (reason instanceof Error) throw reason;
      throw new Error(String(reason || "REQUEST_TIMEOUT"));
    }
    throw error;
  } finally {
    clearTimeout(timer);
    if (reader && !streamCompleted) {
      await reader.cancel().catch(() => undefined);
    }
    try {
      reader?.releaseLock();
    } catch {
      // The stream may already be released after abort/cancel.
    }
  }
}
