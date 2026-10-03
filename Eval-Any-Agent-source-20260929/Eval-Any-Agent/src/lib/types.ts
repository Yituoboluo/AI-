export type InputBinding = {
  placeholder: string;
  column: string;
};

export type ExtractRule = {
  key: string;
  path: string;
  mode?: "text" | "json";
};

export type DoneRule =
  | { type: "sentinel_text"; value: string }
  | { type: "json_path_equals"; path: string; equals: string | number | boolean }
  | { type: "event_name"; value: string }
  | { type: "connection_close" }
  | { type: "max_idle_ms"; value: number };

export type DoneStrategy = "auto" | "manual";
export type StreamProtocol = "auto" | "sse" | "ndjson" | "plain_text";

export type ProviderConfigDto = {
  id: string;
  name: string;
  providerType: "openai_compatible";
  baseUrl: string;
  defaultModel: string;
  enabled: boolean;
  apiKeyMasked: string;
  createdAt: string;
};

export type EvaluatorDto = {
  id: string;
  name: string;
  providerConfigId: string;
  model: string;
  systemPrompt: string;
  userPromptTemplate: string;
  thinkingEnabled: boolean;
  scoreMin: number;
  scoreMax: number;
  passThreshold: number;
  enabled: boolean;
  createdAt: string;
  providerConfig?: {
    id: string;
    name: string;
    baseUrl: string;
    defaultModel: string;
  };
};

export type EvaluationTaskDto = {
  id: string;
  sourceTaskId: string;
  evaluatorId: string;
  status: string;
  totalRows: number;
  successRows: number;
  failedRows: number;
  skippedRows: number;
  avgScore: number | null;
  createdAt: string;
  sourceTask?: { id: string; dataset?: { name: string }; profile?: { name: string } };
  evaluator?: { id: string; name: string };
};

export type EvaluationResultDto = {
  id: string;
  sourceResultId: string;
  rowIndex: number;
  score: number | null;
  passed: boolean | null;
  reason: string | null;
  status: string;
  errorType: string | null;
  errorMessage: string | null;
  rawResponse: string | null;
  promptSnapshot: unknown;
  sourceOutputs: Record<string, unknown>;
  sourceInput: Record<string, unknown>;
};
