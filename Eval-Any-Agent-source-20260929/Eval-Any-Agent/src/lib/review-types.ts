export const REVIEW_LABELS = {
  correct: "判对了",
  incorrect: "判错了",
  uncertain: "暂时无法判断",
} as const;

export type ReviewVerdict = keyof typeof REVIEW_LABELS;

export type ReviewRecord = {
  id: string;
  revision: number;
  verdict: ReviewVerdict;
  reason: string;
  correctedScore: number | null;
  correctedPassed: boolean | null;
  aiScore: number | null;
  aiPassed: boolean | null;
  aiReason: string | null;
  createdAt: string;
  reviewer: { username: string };
};

export type EvidenceImage = {
  key: string;
  label: string;
  title: string;
  url: string;
};

export type ReviewDetail = {
  id: string;
  rowIndex: number;
  score: number | null;
  passed: boolean | null;
  reason: string | null;
  status: string;
  reviewVersion: number;
  sourceInput: Record<string, unknown>;
  sourceOutputs: Record<string, unknown>;
  evaluator: { name: string; scoreMin: number; scoreMax: number; passThreshold: number; systemPrompt: string };
  images: EvidenceImage[];
  reviews: ReviewRecord[];
};
