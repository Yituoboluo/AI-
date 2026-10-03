"use client";

import { useMemo, useState } from "react";
import type { DragEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { Columns3, Download, GripVertical, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type ResultsTableColumn<T> = {
  id: string;
  header: string;
  width?: number;
  minWidth?: number;
  cell: (row: T) => ReactNode;
};

type FilterOption = {
  label: string;
  value: string;
};

type ResultsDataTableProps<T> = {
  rows: T[];
  columns: ResultsTableColumn<T>[];
  getRowKey: (row: T) => string;
  total: number;
  page: number;
  pageSize: number;
  status: string;
  statusOptions: FilterOption[];
  isLoading?: boolean;
  extraFilter?: ReactNode;
  onStatusChange: (value: string) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onRefresh: () => void;
  onDownload: (format: "xlsx" | "csv") => void;
};

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100, 150];

function mergeColumnOrder(previousOrder: string[], currentIds: string[]) {
  const next = previousOrder.filter((id) => currentIds.includes(id));
  for (const id of currentIds) {
    if (next.includes(id)) continue;
    const naturalIndex = currentIds.indexOf(id);
    const previousNaturalId = currentIds.slice(0, naturalIndex).findLast((candidate) => next.includes(candidate));
    if (previousNaturalId) {
      next.splice(next.indexOf(previousNaturalId) + 1, 0, id);
      continue;
    }
    const nextNaturalId = currentIds.slice(naturalIndex + 1).find((candidate) => next.includes(candidate));
    if (nextNaturalId) {
      next.splice(next.indexOf(nextNaturalId), 0, id);
      continue;
    }
    next.push(id);
  }
  return next;
}

export function ResultsDataTable<T>({
  rows,
  columns,
  getRowKey,
  total,
  page,
  pageSize,
  status,
  statusOptions,
  isLoading,
  extraFilter,
  onStatusChange,
  onPageChange,
  onPageSizeChange,
  onRefresh,
  onDownload,
}: ResultsDataTableProps<T>) {
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() =>
    Object.fromEntries(columns.map((column) => [column.id, column.width ?? 180])),
  );
  const [columnOrder, setColumnOrder] = useState<string[]>(() => columns.map((column) => column.id));
  const [hiddenColumnIds, setHiddenColumnIds] = useState<string[]>([]);
  const [draggingColumnId, setDraggingColumnId] = useState("");
  const columnMap = useMemo(() => new Map(columns.map((column) => [column.id, column])), [columns]);
  const columnIds = useMemo(() => columns.map((column) => column.id), [columns]);
  const effectiveColumnOrder = useMemo(() => {
    return mergeColumnOrder(columnOrder, columnIds);
  }, [columnIds, columnOrder]);
  const effectiveVisibleColumnIds = useMemo(() => {
    return columnIds.filter((id) => !hiddenColumnIds.includes(id));
  }, [columnIds, hiddenColumnIds]);
  const orderedColumns = useMemo(
    () => effectiveColumnOrder.map((id) => columnMap.get(id)).filter((column): column is ResultsTableColumn<T> => Boolean(column)),
    [columnMap, effectiveColumnOrder],
  );
  const visibleColumns = useMemo(
    () => orderedColumns.filter((column) => effectiveVisibleColumnIds.includes(column.id)),
    [effectiveVisibleColumnIds, orderedColumns],
  );
  const maxPage = Math.max(1, Math.ceil(total / pageSize));
  const tableWidth = useMemo(
    () => visibleColumns.reduce((sum, column) => sum + (columnWidths[column.id] ?? column.width ?? 180), 0),
    [columnWidths, visibleColumns],
  );

  function resizeColumn(column: ResultsTableColumn<T>, event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = columnWidths[column.id] ?? column.width ?? 180;
    const minWidth = column.minWidth ?? 100;

    function onPointerMove(moveEvent: PointerEvent) {
      const nextWidth = Math.max(minWidth, startWidth + moveEvent.clientX - startX);
      setColumnWidths((prev) => ({ ...prev, [column.id]: nextWidth }));
    }

    function onPointerUp() {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
  }

  function toggleColumn(columnId: string, checked: boolean) {
    setHiddenColumnIds((prev) => {
      if (checked) return prev.filter((id) => id !== columnId);
      if (effectiveVisibleColumnIds.length <= 1) return prev;
      return prev.includes(columnId) ? prev : [...prev, columnId];
    });
  }

  function reorderColumn(targetColumnId: string) {
    if (!draggingColumnId || draggingColumnId === targetColumnId) return;
    setColumnOrder((prev) => {
      const current = mergeColumnOrder(prev, columnIds);
      const from = current.indexOf(draggingColumnId);
      const to = current.indexOf(targetColumnId);
      if (from < 0 || to < 0) return prev;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  function onColumnDragStart(columnId: string, event: DragEvent<HTMLButtonElement>) {
    setDraggingColumnId(columnId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", columnId);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              <Columns3 data-icon="inline-start" />
              筛选列
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>显示字段</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
              {orderedColumns.map((column) => (
                <div
                  key={column.id}
                  className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    reorderColumn(column.id);
                  }}
                >
                  <button
                    type="button"
                    draggable
                    aria-label={`拖拽排序${column.header}`}
                    className="cursor-grab text-muted-foreground active:cursor-grabbing"
                    onDragStart={(event) => onColumnDragStart(column.id, event)}
                    onDragEnd={() => setDraggingColumnId("")}
                  >
                    <GripVertical data-icon="inline-start" />
                  </button>
                  <Checkbox
                  checked={effectiveVisibleColumnIds.includes(column.id)}
                    onCheckedChange={(checked) => toggleColumn(column.id, Boolean(checked))}
                    aria-label={`显示${column.header}`}
                  />
                  <span className="min-w-0 flex-1 truncate">{column.header}</span>
                </div>
              ))}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
        <Select value={status} onValueChange={onStatusChange}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="状态" />
          </SelectTrigger>
          <SelectContent>
            {statusOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {extraFilter}
        <Select value={String(pageSize)} onValueChange={(value) => onPageSizeChange(Number(value))}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="每页数量" />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_OPTIONS.map((option) => (
              <SelectItem key={option} value={String(option)}>
                {option} / 页
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={onRefresh} disabled={isLoading}>
          <RefreshCw data-icon="inline-start" />
          刷新
        </Button>
        <Button variant="outline" onClick={() => onDownload("xlsx")}>
          <Download data-icon="inline-start" />
          XLSX
        </Button>
        <Button variant="outline" onClick={() => onDownload("csv")}>
          <Download data-icon="inline-start" />
          CSV
        </Button>
      </div>

      <Table className="table-fixed" style={{ width: tableWidth }}>
        <TableHeader>
          <TableRow>
            {visibleColumns.map((column) => (
              <TableHead
                key={column.id}
                className="relative h-12 select-none pr-5 align-middle"
                style={{ width: columnWidths[column.id] ?? column.width ?? 180 }}
              >
                <span className="flex min-h-10 items-center whitespace-normal break-words">{column.header}</span>
                <button
                  type="button"
                  aria-label={`调整${column.header}列宽`}
                  className="absolute right-0 top-0 flex h-full w-4 cursor-col-resize items-center justify-center rounded-none border-0 bg-transparent p-0 hover:bg-muted"
                  onPointerDown={(event) => resizeColumn(column, event)}
                >
                  <span className="h-7 w-px rounded bg-muted-foreground/70" />
                </button>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length > 0 ? (
            rows.map((row) => (
              <TableRow key={getRowKey(row)}>
                {visibleColumns.map((column) => (
                  <TableCell
                    key={column.id}
                    className="whitespace-normal break-words align-top"
                    style={{ width: columnWidths[column.id] ?? column.width ?? 180 }}
                  >
                    {column.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell className={cn("h-32 text-center text-muted-foreground")} colSpan={visibleColumns.length}>
                {isLoading ? "加载中..." : "暂无数据"}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <div>
          共 {total} 条，第 {page} / {maxPage} 页
        </div>
        <Pagination className="mx-0 w-auto">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                href="#"
                onClick={(event) => {
                  event.preventDefault();
                  onPageChange(Math.max(1, page - 1));
                }}
              />
            </PaginationItem>
            <PaginationItem className="px-3 text-sm text-foreground">{page} / {maxPage}</PaginationItem>
            <PaginationItem>
              <PaginationNext
                href="#"
                onClick={(event) => {
                  event.preventDefault();
                  onPageChange(Math.min(maxPage, page + 1));
                }}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    </div>
  );
}
