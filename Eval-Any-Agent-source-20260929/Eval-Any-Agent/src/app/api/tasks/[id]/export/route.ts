import ExcelJS from "exceljs";
import { requireSession } from "@/lib/auth";
import { fail } from "@/lib/http";
import { parseJson } from "@/lib/json";
import { prisma } from "@/lib/prisma";

function formatTimestamp(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function stripFileExt(name: string) {
  return name.replace(/\.[^.]+$/, "");
}

function toCsv(records: Record<string, unknown>[]) {
  if (!records.length) return "";
  const headers = Object.keys(records[0]);
  const lines = [headers.join(",")];
  for (const row of records) {
    const line = headers
      .map((h) => {
        const value = row[h] == null ? "" : String(row[h]);
        const escaped = value.replaceAll('"', '""');
        return `"${escaped}"`;
      })
      .join(",");
    lines.push(line);
  }
  return lines.join("\n");
}

function parseExportColumns(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string" && v.length > 0);
  } catch {
    return [];
  }
}

function normalizeHeader(key: string): string {
  if (key.startsWith("input:")) return key.replace("input:", "");
  if (key.startsWith("output:")) return key.replace("output:", "");
  if (key.startsWith("result:")) return key.replace("result:", "");
  return key;
}

function getValueByKey(
  key: string,
  inputData: Record<string, unknown>,
  outputs: Record<string, unknown>,
  resultMap: Record<string, unknown>,
) {
  if (key.startsWith("input:")) return inputData[key.replace("input:", "")] ?? "";
  if (key.startsWith("output:")) return outputs[key.replace("output:", "")] ?? "";
  if (key.startsWith("result:")) return resultMap[key.replace("result:", "")] ?? "";
  return "";
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const url = new URL(req.url);
    const format = url.searchParams.get("format") || "xlsx";
    const selectedColumns = parseExportColumns(url.searchParams.get("columns"));

    const task = await prisma.evalTask.findFirst({
      where: { id, userId: session.uid },
      include: { profile: true, dataset: true },
    });
    if (!task) return fail("任务不存在", 404);

    const results = await prisma.evalResult.findMany({
      where: { taskId: id },
      orderBy: { rowIndex: "asc" },
    });

    const extractRules = parseJson<Array<{ key: string }>>(task.profile.extractRules, []);
    const records = results.map((row) => {
      const outputs = parseJson<Record<string, unknown>>(row.outputs, {});
      const inputData = parseJson<Record<string, unknown>>(row.inputData, {});
      const out: Record<string, unknown> = {
        rowIndex: row.rowIndex,
        ttftMs: row.ttftMs,
        latencyMs: row.latencyMs,
        ruleHit: row.ruleHit,
      };

      if (selectedColumns.length > 0) {
        const custom: Record<string, unknown> = {};
        for (const key of selectedColumns) {
          custom[normalizeHeader(key)] = getValueByKey(key, inputData, outputs, out);
        }
        return custom;
      }

      for (const rule of extractRules) {
        out[rule.key] = outputs[rule.key] ?? "";
      }
      out.status = row.status;
      out.endReason = row.endReason;
      out.errorType = row.errorType;
      out.errorMessage = row.errorMessage;
      return out;
    });
    const ttftValues = results.map((r) => r.ttftMs).filter((v): v is number => typeof v === "number");
    const avgTtft = ttftValues.length
      ? Math.round(ttftValues.reduce((sum, n) => sum + n, 0) / ttftValues.length)
      : 0;
    const datasetName = stripFileExt(task.dataset.name);
    const fileBase = `${datasetName}-${task.profile.name}-${formatTimestamp(new Date())}-RT=${avgTtft}`;

    if (format === "csv") {
      const csv = toCsv(records);
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileBase)}.csv`,
        },
      });
    }

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("results");
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
    return fail("导出失败", 500);
  }
}
