import { requireSession } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { stringifyJson } from "@/lib/json";
import { prisma } from "@/lib/prisma";
import { parseDataset } from "@/lib/upload";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    const form = await req.formData();
    const file = form.get("file");
    const name = String(form.get("name") || "").trim();

    if (!(file instanceof File)) return fail("缺少文件", 400);

    const parsed = await parseDataset(file);
    const dataset = await prisma.dataset.create({
      data: {
        userId: session.uid,
        name: name || file.name,
        fileType: parsed.fileType,
        rowCount: parsed.rows.length,
        columns: stringifyJson(parsed.columns),
        rows: stringifyJson(parsed.rows),
      },
    });

    return ok(dataset);
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return fail("未登录", 401);
    if (error instanceof Error && error.message === "UNSUPPORTED_FILE_TYPE") return fail("仅支持 CSV/XLSX", 400);
    return fail("上传失败", 500);
  }
}
