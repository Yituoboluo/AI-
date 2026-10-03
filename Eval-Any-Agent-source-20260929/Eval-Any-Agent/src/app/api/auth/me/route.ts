import { getSession } from "@/lib/auth";
import { fail, ok } from "@/lib/http";

export async function GET() {
  const session = await getSession();
  if (!session) return fail("未登录", 401);
  return ok(session);
}
