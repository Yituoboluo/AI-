import { requireSession } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { parseJson } from "@/lib/json";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const session = await requireSession();
    const list = await prisma.dataset.findMany({
      where: { userId: session.uid },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        fileType: true,
        rowCount: true,
        columns: true,
        createdAt: true,
      },
    });
    return ok(
      list.map((item) => ({
        ...item,
        columns: parseJson<string[]>(item.columns, []),
      })),
    );
  } catch {
    return fail("未登录", 401);
  }
}
