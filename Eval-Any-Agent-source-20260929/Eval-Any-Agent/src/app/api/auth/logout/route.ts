import { logout } from "@/lib/auth";
import { ok } from "@/lib/http";

export async function POST() {
  await logout();
  return ok({});
}
