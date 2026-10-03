import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { z } from "zod";

const evaluationResponseSchema = z.object({
  score: z.number(),
  reason: z.string(),
  passed: z.boolean(),
});

export type EvaluateByLlmInput = {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  thinkingEnabled?: boolean;
  timeoutMs?: number;
};

export type EvaluateByLlmOutput = z.infer<typeof evaluationResponseSchema> & {
  rawResponse: string;
};

function extractJsonObject(text: string) {
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) return fencedMatch[1].trim();

  // Models may append an explanation after the JSON object. Find the first
  // balanced object instead of using the last closing brace, which can pull
  // the explanation into the JSON and cause a false evaluator failure.
  const start = text.indexOf("{");
  if (start >= 0) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const char = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) return text.slice(start, index + 1);
      }
    }
  }
  return text;
}

export async function evaluateByLlm(input: EvaluateByLlmInput): Promise<EvaluateByLlmOutput> {
  const client = new OpenAI({
    apiKey: input.apiKey,
    baseURL: input.baseUrl,
    timeout: input.timeoutMs ?? 60000,
  });

  const thinkingParams = input.thinkingEnabled ? { enable_thinking: true } : {};
  const params: ChatCompletionCreateParamsNonStreaming & {
    enable_thinking?: boolean;
  } = {
    model: input.model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: input.systemPrompt },
      { role: "user", content: input.userPrompt },
    ],
    ...thinkingParams,
  };
  const completion = await client.chat.completions.create(params);

  const rawResponse = completion.choices[0]?.message?.content ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(rawResponse));
  } catch (error) {
    const message = error instanceof Error ? error.message : "JSON 解析失败";
    throw new Error(`模型返回内容不是合法 JSON：${message}`);
  }
  const result = evaluationResponseSchema.parse(parsed);
  // Evaluators sometimes return a normalized score in the 0..1 range even
  // though the app's score contract is 0..100. Normalize at the boundary so
  // storage, pass/fail thresholds, averages, and exports use one scale.
  const score = result.score >= 0 && result.score <= 1 ? result.score * 100 : result.score;

  return {
    ...result,
    score,
    rawResponse,
  };
}
