import Papa from "papaparse";
import * as XLSX from "xlsx";

export type DatasetParsed = {
  columns: string[];
  rows: Record<string, unknown>[];
  fileType: "csv" | "xlsx";
};

function isEmptyValue(value: unknown) {
  if (value === null || value === undefined) return true;
  return typeof value === "string" ? value.trim() === "" : false;
}

function isEmptyColumnName(column: string) {
  const normalized = column.trim();
  return normalized === "" || /^__EMPTY(?:_\d+)?$/.test(normalized);
}

function cleanRows(rows: Record<string, unknown>[], preferredColumns?: string[]) {
  const columnSet = new Set<string>();
  for (const column of preferredColumns ?? []) {
    if (!isEmptyColumnName(column)) columnSet.add(column);
  }
  for (const row of rows) {
    for (const [column, value] of Object.entries(row)) {
      if (!isEmptyColumnName(column) && !isEmptyValue(value)) columnSet.add(column);
    }
  }

  const columns = Array.from(columnSet);
  const cleanedRows = rows
    .map((row) => {
      const next: Record<string, unknown> = {};
      for (const column of columns) {
        next[column] = row[column] ?? "";
      }
      return next;
    })
    .filter((row) => Object.values(row).some((value) => !isEmptyValue(value)));

  return { columns, rows: cleanedRows };
}

export async function parseDataset(file: File): Promise<DatasetParsed> {
  const name = file.name.toLowerCase();
  const bytes = Buffer.from(await file.arrayBuffer());

  if (name.endsWith(".csv")) {
    const text = bytes.toString("utf-8");
    const parsed = Papa.parse<Record<string, unknown>>(text, {
      header: true,
      skipEmptyLines: true,
    });

    const { rows, columns } = cleanRows(parsed.data, parsed.meta.fields);
    return { rows, columns, fileType: "csv" };
  }

  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const workbook = XLSX.read(bytes, { type: "buffer" });
    const firstSheet = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheet];
    const allRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: "" });
    const { rows, columns } = cleanRows(allRows);
    return { rows, columns, fileType: "xlsx" };
  }

  throw new Error("UNSUPPORTED_FILE_TYPE");
}
