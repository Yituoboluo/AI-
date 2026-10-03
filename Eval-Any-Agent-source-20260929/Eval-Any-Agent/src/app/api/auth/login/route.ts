import { z } from "zod";
import { fail, ok } from "@/lib/http";
import { login } from "@/lib/auth";

const schema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return fail("参数不合法", 400);

  const success = await login(parsed.data.username, parsed.data.password);
  if (!success) return fail("用户名或密码错误", 401);
  return ok({ username: parsed.data.username });
}
