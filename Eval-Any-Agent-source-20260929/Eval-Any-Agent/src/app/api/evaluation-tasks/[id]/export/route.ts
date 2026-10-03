import ExcelJS from "exceljs";
import { requireSession } from "@/lib/auth";
import { fail } from "@/lib/http";
import { parseJson } from "@/lib/json";
import { prisma } from "@/lib/prisma";
import { REVIEW_LABELS, type ReviewVerdict } from "@/lib/review-types";

function formatTimestamp(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toCsv(records: Record<string, unknown>[]) {
  if (!records.length) return "";
  const headers = Object.keys(records[0]);
  const lines = [headers.join(",")];
  for (const row of records) {
    lines.push(
      headers
        .map((header) => {
          const raw = String(row[header] ?? "");
          const value = /^[\s]*[=+@-]/.test(raw) ? `'${raw}` : raw;
          return `"${value.replaceAll('"', '""')}"`;
        })
        .join(","),
    );
  }
  return lines.join("\n");
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const url = new URL(req.url);
    const format = url.searchParams.get("format") || "xlsx";

    const task = await prisma.evaluationTask.findFirst({
      where: { id, userId: session.uid },
      include: {
        evaluator: true,
        sourceTask: { include: { dataset: true } },
      },
    });
    if (!task) return fail("评估任务不存在", 404);

    const rows = await prisma.evaluationResult.findMany({
      where: { evaluationTaskId: id },
      orderBy: { rowIndex: "asc" },
      include: { sourceResult: true, reviews: { orderBy: { revision: "desc" }, include: { reviewer: { select: { username: true } } } } },
    });

    const records = rows.map((row) => {
      const input = parseJson<Record<string, unknown>>(row.sourceResult.inputData, {});
      const outputs = parseJson<Record<string, unknown>>(row.sourceResult.outputs, {});
      const latest = row.reviews[0];
      return {
        rowIndex: row.rowIndex,
        caseId: input.case_id ?? "",
        caseName: input.name ?? "",
        score: row.score ?? "",
        passed: row.passed ?? "",
        reason: row.reason ?? "",
        sourcePreview: Object.values(outputs).find((item) => typeof item === "string" && item.trim()) ?? "",
        reference_output: input.reference_output ?? "",
        status: row.status,
        sourceStatus: row.sourceResult.status,
        errorType: row.errorType ?? "",
        errorMessage: row.errorMessage ?? "",
        manualVerdict: latest ? REVIEW_LABELS[latest.verdict as ReviewVerdict] : "待复核",
        manualReason: latest?.reason ?? "",
        manualScore: latest?.correctedScore ?? "",
        manualPassed: latest?.correctedPassed ?? "",
        reviewer: latest?.reviewer.username ?? "",
        reviewedAt: latest?.createdAt.toISOString() ?? "",
        reviewCount: row.reviewVersion,
        reviewHistory: JSON.stringify(row.reviews.map((item) => ({ revision: item.revision, verdict: REVIEW_LABELS[item.verdict as ReviewVerdict], reason: item.reason, correctedScore: item.correctedScore, correctedPassed: item.correctedPassed, reviewer: item.reviewer.username, createdAt: item.createdAt }))),
      };
    });

    const avgScore = task.avgScore == null ? "NA" : Math.round(task.avgScore * 100) / 100;
    const fileBase = `${task.sourceTask.dataset.name}-${task.evaluator.name}-${formatTimestamp(new Date())}-AVG=${avgScore}`;

    if (format === "csv") {
      return new Response(`\uFEFF${toCsv(records)}`, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileBase)}.csv`,
        },
      });
    }

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("evaluation-results");
    if (records.length > 0) {
      sheet.columns = Object.keys(records[0]).map((key) => ({ header: key, key }));
      sheet.addRows(records);
    }
    const buffer = await workbook.xlsx.writeBuffer();

    return new Response(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileBase)}.xlsx`,
      },
    });
  } catch {
    return fail("导出评估结果失败", 500);
  }
}
