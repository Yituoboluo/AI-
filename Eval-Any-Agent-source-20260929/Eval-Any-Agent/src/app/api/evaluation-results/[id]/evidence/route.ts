import { requireSession } from "@/lib/auth";
import { fail } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { ReviewError } from "@/lib/manual-review";
import { collectEvidence, readEvidenceFile } from "@/lib/review-evidence";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const result = await prisma.evaluationResult.findFirst({
      where: { id, evaluationTask: { userId: session.uid } },
      include: { sourceResult: true },
    });
    if (!result) return fail("评估结果不存在", 404);
    const key = new URL(req.url).searchParams.get("key");
    const file = collectEvidence(result.sourceResult.inputData, result.sourceResult.outputs).find((image) => image.key === key);
    if (!file) return fail("该用例没有这张证据图片", 404);
    const { bytes, contentType } = await readEvidenceFile(file);
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": contentType, "Content-Length": String(bytes.length),
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    } });
  } catch (error) {
    if (error instanceof ReviewError) return fail(error.message, error.status);
    if (error instanceof Error && error.message === "UNAUTHORIZED") return fail("请先登录", 401);
    return fail("读取证据图片失败", 500);
  }
}
