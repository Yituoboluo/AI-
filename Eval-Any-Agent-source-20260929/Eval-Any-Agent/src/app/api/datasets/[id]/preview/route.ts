import { requireSession } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { parseJson } from "@/lib/json";
import { prisma } from "@/lib/prisma";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const dataset = await prisma.dataset.findFirst({
      where: { id, userId: session.uid },
      select: {
        id: true,
        columns: true,
        rows: true,
        rowCount: true,
      },
    });
    if (!dataset) return fail("数据集不存在", 404);
    const rows = parseJson<Record<string, unknown>[]>(dataset.rows, []);
    return ok({
      id: dataset.id,
      columns: parseJson<string[]>(dataset.columns, []),
      rowCount: dataset.rowCount,
      sampleRows: rows.slice(0, 10),
    });
  } catch {
    return fail("未登录", 401);
  }
}
