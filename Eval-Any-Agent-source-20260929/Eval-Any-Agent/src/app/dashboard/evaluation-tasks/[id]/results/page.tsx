"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ResultsDataTable, type ResultsTableColumn } from "@/components/results-data-table";
import { ManualReviewDialog } from "@/components/manual-review-dialog";
import { REVIEW_LABELS, type ReviewRecord, type ReviewVerdict } from "@/lib/review-types";
import { api } from "@/lib/client-api";

type EvaluationTaskDetail = {
  id: string;
  status: string;
  totalRows: number;
  successRows: number;
  failedRows: number;
  skippedRows: number;
  avgScore: number | null;
  createdAt: string;
  evaluator: { name: string };
  sourceTask: {
    dataset: { name: string; columns: string[] | string };
    profile: { name: string };
  };
};

type EvaluationResultRow = {
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
  reviewVersion: number;
  reviewVerdict: ReviewVerdict | null;
  latestReview: ReviewRecord | null;
};

function previewValue(value: unknown) {
  if (value == null) return "-";
  if (typeof value === "string") return value || "-";
  return JSON.stringify(value, null, 2);
}

function parseColumnNames(value: string[] | string | undefined) {
  if (Array.isArray(value)) return value.filter((item) => item && !isEmptyColumnName(item));
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && item.length > 0 && !isEmptyColumnName(item))
      : [];
  } catch {
    return [];
  }
}

function isEmptyColumnName(column: string) {
  return column.trim() === "" || /^__EMPTY(?:_\d+)?$/.test(column.trim());
}

function getStructuredKeys<T>(
  configuredColumns: string[],
  rows: T[],
  accessor: (row: T) => Record<string, unknown>,
) {
  const discovered = rows.flatMap((row) => Object.keys(accessor(row)).filter((key) => !isEmptyColumnName(key)));
  return Array.from(new Set([...configuredColumns, ...discovered]));
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const pad = (num: number) => String(num).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function EvaluationTaskResultsPage() {
  const params = useParams<{ id: string }>();
  const evaluationTaskId = params.id;
  const [task, setTask] = useState<EvaluationTaskDetail | null>(null);
  const [rows, setRows] = useState<EvaluationResultRow[]>([]);
  const [total, setTotal] = useState(0);
  const [avgScore, setAvgScore] = useState<number | null>(null);
  const [passRate, setPassRate] = useState(0);
  const [successCount, setSuccessCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [status, setStatus] = useState("all");
  const [passed, setPassed] = useState("all");
  const [review, setReview] = useState("all");
  const [reviewCounts, setReviewCounts] = useState({ pending: 0, correct: 0, incorrect: 0, uncertain: 0 });
  const [reviewResultId, setReviewResultId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [detailText, setDetailText] = useState("");
  const [detailOpen, setDetailOpen] = useState(false);

  const loadTask = useCallback(async () => {
    const data = await api<EvaluationTaskDetail>(`/api/evaluation-tasks/${evaluationTaskId}`);
    setTask(data);
  }, [evaluationTaskId]);

  const loadResults = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        status,
        passed,
        review,
      });
      const data = await api<{
        total: number;
        rows: EvaluationResultRow[];
        avgScore: number | null;
        passRate: number;
        successCount: number;
        reviewCounts: typeof reviewCounts;
      }>(`/api/evaluation-tasks/${evaluationTaskId}/results?${params.toString()}`);
      setRows(data.rows);
      setTotal(data.total);
      setAvgScore(data.avgScore);
      setPassRate(data.passRate);
      setSuccessCount(data.successCount);
      setReviewCounts(data.reviewCounts);
    } finally {
      setIsLoading(false);
    }
  }, [evaluationTaskId, page, pageSize, passed, status, review]);

  useEffect(() => {
    loadTask().catch((error) => toast.error(error.message));
  }, [loadTask]);

  useEffect(() => {
    loadResults().catch((error) => toast.error(error.message));
  }, [loadResults]);

  const sourceInputKeys = useMemo(
    () => getStructuredKeys(parseColumnNames(task?.sourceTask.dataset.columns), rows, (row) => row.sourceInput),
    [rows, task?.sourceTask.dataset.columns],
  );
  const sourceOutputKeys = useMemo(() => getStructuredKeys([], rows, (row) => row.sourceOutputs), [rows]);

  const columns = useMemo<ResultsTableColumn<EvaluationResultRow>[]>(
    () => [
      { id: "rowIndex", header: "行号", width: 90, minWidth: 80, cell: (row) => row.rowIndex },
      { id: "reviewAction", header: "人工复核", width: 140, minWidth: 120, cell: (row) => <Button size="sm" variant="outline" onClick={() => setReviewResultId(row.id)}>{row.reviewVersion ? "查看 / 再复核" : "人工复核"}</Button> },
      { id: "caseName", header: "用例", width: 180, minWidth: 140, cell: (row) => [row.sourceInput.case_id, row.sourceInput.name].filter((value) => typeof value === "string").join(" · ") || "-" },
      { id: "reviewVerdict", header: "复核结论", width: 170, minWidth: 140, cell: (row) => <Badge variant={row.reviewVerdict === "incorrect" ? "destructive" : "secondary"}>{row.reviewVerdict ? REVIEW_LABELS[row.reviewVerdict] : "待复核"}</Badge> },
      { id: "score", header: "评分", width: 100, minWidth: 90, cell: (row) => row.score ?? "-" },
      {
        id: "passed",
        header: "是否通过",
        width: 120,
        minWidth: 100,
        cell: (row) => (row.passed == null ? "-" : row.passed ? "🟢" : "❌"),
      },
      { id: "reason", header: "原因", width: 320, minWidth: 180, cell: (row) => row.reason ?? "-" },
      ...sourceInputKeys.map((key) => ({
        id: `sourceInput:${key}`,
        header: `来源输入：${key}`,
        width: 220,
        minWidth: 140,
        cell: (row: EvaluationResultRow) => previewValue(row.sourceInput[key]),
      })),
      ...sourceOutputKeys.map((key) => ({
        id: `sourceOutput:${key}`,
        header: `来源输出：${key}`,
        width: 260,
        minWidth: 150,
        cell: (row: EvaluationResultRow) => previewValue(row.sourceOutputs[key]),
      })),
      { id: "rawResponse", header: "工具调用/原始响应", width: 320, minWidth: 180, cell: (row) => row.rawResponse ?? "-" },
      {
        id: "detail",
        header: "详情",
        width: 100,
        minWidth: 90,
        cell: (row) => (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setDetailText(JSON.stringify(row, null, 2));
              setDetailOpen(true);
            }}
          >
            查看
          </Button>
        ),
      },
      {
        id: "status",
        header: "状态",
        width: 120,
        minWidth: 100,
        cell: (row) => <Badge variant={row.status === "failed" ? "destructive" : "secondary"}>{row.status}</Badge>,
      },
      { id: "errorType", header: "错误类型", width: 160, minWidth: 120, cell: (row) => row.errorType ?? "-" },
      { id: "errorMessage", header: "错误信息", width: 260, minWidth: 160, cell: (row) => row.errorMessage ?? "-" },
    ],
    [sourceInputKeys, sourceOutputKeys],
  );

  function download(format: "xlsx" | "csv") {
    window.open(`/api/evaluation-tasks/${evaluationTaskId}/export?format=${format}`, "_blank");
  }

  async function startReview() {
    try {
      const data = await api<{ rows: EvaluationResultRow[] }>(`/api/evaluation-tasks/${evaluationTaskId}/results?review=pending&pageSize=150`);
      const first = data.rows.find((row) => row.passed === false) ?? data.rows[0];
      if (first) setReviewResultId(first.id);
      else toast.info("本批结果都已复核，可在表格中查看历史或再次复核");
    } catch (error) { toast.error(error instanceof Error ? error.message : "加载失败，请重试"); }
  }

  return (
    <div className="min-h-screen bg-muted/30 p-4 md:p-8">
      <div className="mx-auto flex w-full max-w-none flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">评估结果</h1>
            <p className="text-sm text-muted-foreground">
              {task
                ? `${task.sourceTask.dataset.name} / ${task.sourceTask.profile.name} / ${task.evaluator.name} / ${formatDateTime(task.createdAt)}`
                : "加载中..."}
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/dashboard">返回控制台</Link>
          </Button>
        </div>

        {task ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">AI 平均分</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold">{avgScore == null ? "-" : avgScore.toFixed(2)}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">AI 通过率</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold">{(passRate * 100).toFixed(1)}%</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">成功评估数</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold">{successCount}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">状态</CardTitle>
              </CardHeader>
              <CardContent><Badge>{task.status}</Badge></CardContent>
            </Card>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background px-4 py-3">
          <div className="space-y-1">
            <h2 className="font-semibold">人工复核</h2>
            <p className="text-sm text-muted-foreground">本批待复核 {reviewCounts.pending} 条 · 判对 {reviewCounts.correct} 条 · 判错 {reviewCounts.incorrect} 条 · 暂无法判断 {reviewCounts.uncertain} 条</p>
            <p className="text-xs text-muted-foreground">先看 AI 未通过的用例，对照原图、成品和理由，再保存你的判断。</p>
          </div>
          <Button onClick={startReview} disabled={isLoading || !reviewCounts.pending}>开始复核</Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>结果表格</CardTitle>
            <CardDescription>每行可直接人工复核；CSV / XLSX 包含复核结论、理由和历史记录。</CardDescription>
          </CardHeader>
          <CardContent>
            <ResultsDataTable
              rows={rows}
              columns={columns}
              getRowKey={(row) => row.id}
              total={total}
              page={page}
              pageSize={pageSize}
              status={status}
              statusOptions={[
                { label: "全部状态", value: "all" },
                { label: "success", value: "success" },
                { label: "failed", value: "failed" },
                { label: "skipped", value: "skipped" },
              ]}
              extraFilter={
                <>
                <Select
                  value={passed}
                  onValueChange={(value) => {
                    setPassed(value);
                    setPage(1);
                  }}
                >
                  <SelectTrigger className="w-36">
                    <SelectValue placeholder="是否通过" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部通过状态</SelectItem>
                    <SelectItem value="true">通过</SelectItem>
                    <SelectItem value="false">未通过</SelectItem>
                    <SelectItem value="null">未评估</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={review} onValueChange={(value) => { setReview(value); setPage(1); }}>
                  <SelectTrigger className="w-40" aria-label="按复核结论筛选"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部复核状态</SelectItem>
                    <SelectItem value="pending">待复核</SelectItem>
                    <SelectItem value="reviewed">已复核</SelectItem>
                    <SelectItem value="correct">判对了</SelectItem>
                    <SelectItem value="incorrect">判错了</SelectItem>
                    <SelectItem value="uncertain">暂时无法判断</SelectItem>
                  </SelectContent>
                </Select>
                </>
              }
              isLoading={isLoading}
              onStatusChange={(value) => {
                setStatus(value);
                setPage(1);
              }}
              onPageChange={setPage}
              onPageSizeChange={(value) => {
                setPageSize(value);
                setPage(1);
              }}
              onRefresh={loadResults}
              onDownload={download}
            />
          </CardContent>
        </Card>
      </div>

      {reviewResultId ? <ManualReviewDialog key={reviewResultId} resultId={reviewResultId} onClose={() => setReviewResultId(null)} onSaved={() => { loadResults().catch((error: Error) => toast.error(error.message)); }} /> : null}

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="w-[96vw] max-w-[96vw] sm:max-w-[96vw] overflow-hidden p-0">
          <DialogHeader>
            <DialogTitle className="px-6 pt-6">结果详情</DialogTitle>
          </DialogHeader>
          <div className="min-w-0 px-6 pb-6">
            <div className="h-[82vh] min-w-0 max-w-full overflow-x-scroll overflow-y-scroll rounded border bg-card p-3">
              <pre className="block w-max max-w-none whitespace-pre text-xs">{detailText}</pre>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
