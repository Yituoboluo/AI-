"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ResultsDataTable, type ResultsTableColumn } from "@/components/results-data-table";
import { api } from "@/lib/client-api";

type TaskDetail = {
  id: string;
  status: string;
  totalRows: number;
  successRows: number;
  failedRows: number;
  createdAt: string;
  dataset: { name: string; columns: string[] | string };
  profile: { name: string };
};

type ResultRow = {
  id: string;
  rowIndex: number;
  inputData: Record<string, unknown>;
  requestPayload: Record<string, unknown>;
  outputs: Record<string, unknown>;
  rawTrace: unknown[];
  status: string;
  ttftMs: number | null;
  latencyMs: number | null;
  errorType: string | null;
  errorMessage: string | null;
  endReason: string | null;
  ruleHit: string | null;
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

export default function TaskResultsPage() {
  const params = useParams<{ id: string }>();
  const taskId = params.id;
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [total, setTotal] = useState(0);
  const [avgTtftMs, setAvgTtftMs] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [status, setStatus] = useState("all");
  const [isLoading, setIsLoading] = useState(false);
  const [detailText, setDetailText] = useState("");
  const [detailOpen, setDetailOpen] = useState(false);

  const loadTask = useCallback(async () => {
    const data = await api<TaskDetail>(`/api/tasks/${taskId}`);
    setTask(data);
  }, [taskId]);

  const loadResults = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        status,
      });
      const data = await api<{ total: number; rows: ResultRow[]; avgTtftMs: number | null }>(
        `/api/tasks/${taskId}/results?${params.toString()}`,
      );
      setRows(data.rows);
      setTotal(data.total);
      setAvgTtftMs(data.avgTtftMs);
    } finally {
      setIsLoading(false);
    }
  }, [page, pageSize, status, taskId]);

  useEffect(() => {
    loadTask().catch((error) => toast.error(error.message));
  }, [loadTask]);

  useEffect(() => {
    loadResults().catch((error) => toast.error(error.message));
  }, [loadResults]);

  const inputKeys = useMemo(
    () => getStructuredKeys(parseColumnNames(task?.dataset.columns), rows, (row) => row.inputData),
    [rows, task?.dataset.columns],
  );
  const requestPayloadKeys = useMemo(() => getStructuredKeys([], rows, (row) => row.requestPayload), [rows]);
  const outputKeys = useMemo(() => getStructuredKeys([], rows, (row) => row.outputs), [rows]);

  const columns = useMemo<ResultsTableColumn<ResultRow>[]>(
    () => [
      { id: "rowIndex", header: "行号", width: 90, minWidth: 80, cell: (row) => row.rowIndex },
      { id: "ttftMs", header: "TTFT(ms)", width: 120, minWidth: 100, cell: (row) => row.ttftMs ?? "-" },
      { id: "latencyMs", header: "总耗时(ms)", width: 130, minWidth: 110, cell: (row) => row.latencyMs ?? "-" },
      ...inputKeys.map((key) => ({
        id: `input:${key}`,
        header: `输入：${key}`,
        width: 220,
        minWidth: 140,
        cell: (row: ResultRow) => previewValue(row.inputData[key]),
      })),
      ...requestPayloadKeys.map((key) => ({
        id: `requestPayload:${key}`,
        header: `请求：${key}`,
        width: 220,
        minWidth: 140,
        cell: (row: ResultRow) => previewValue(row.requestPayload[key]),
      })),
      ...outputKeys.map((key) => ({
        id: `output:${key}`,
        header: `输出：${key}`,
        width: 260,
        minWidth: 150,
        cell: (row: ResultRow) => previewValue(row.outputs[key]),
      })),
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
      { id: "endReason", header: "结束原因", width: 180, minWidth: 120, cell: (row) => row.endReason ?? "-" },
      { id: "errorType", header: "错误类型", width: 160, minWidth: 120, cell: (row) => row.errorType ?? "-" },
      { id: "errorMessage", header: "错误信息", width: 260, minWidth: 160, cell: (row) => row.errorMessage ?? "-" },
    ],
    [inputKeys, outputKeys, requestPayloadKeys],
  );

  function download(format: "xlsx" | "csv") {
    window.open(`/api/tasks/${taskId}/export?format=${format}`, "_blank");
  }

  return (
    <div className="min-h-screen bg-muted/30 p-4 md:p-8">
      <div className="mx-auto flex w-full max-w-none flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">任务结果</h1>
            <p className="text-sm text-muted-foreground">
              {task ? `${task.dataset.name} / ${task.profile.name} / ${formatDateTime(task.createdAt)}` : "加载中..."}
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
                <CardTitle className="text-base">总行数</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold">{task.totalRows}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">成功 / 失败</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold">{task.successRows} / {task.failedRows}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">平均 TTFT</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold">{avgTtftMs == null ? "-" : `${Math.round(avgTtftMs)} ms`}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">状态</CardTitle>
              </CardHeader>
              <CardContent><Badge>{task.status}</Badge></CardContent>
            </Card>
          </div>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>结果表格</CardTitle>
            <CardDescription>支持服务端筛选、列宽拖拽、分页数量调整和快速下载</CardDescription>
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
                { label: "warning", value: "warning" },
              ]}
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
