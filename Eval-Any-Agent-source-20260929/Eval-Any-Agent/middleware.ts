import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const AUTH_COOKIE = "eval_agent_session";

function getAuthSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET is required in production");
  }
  return new TextEncoder().encode(secret || "local-dev-auth-secret");
}

async function hasValidToken(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(AUTH_COOKIE)?.value;
  if (!token) return false;
  try {
    await jwtVerify(token, getAuthSecret());
    return true;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/api/health") ||
    pathname.startsWith("/api/auth/login")
  ) {
    return NextResponse.next();
  }

  const tokenValid = await hasValidToken(req);
  const isLoginPage = pathname.startsWith("/login");
  const isApi = pathname.startsWith("/api/");

  if (!tokenValid && isApi) {
    const res = NextResponse.json({ ok: false, message: "未登录" }, { status: 401 });
    res.cookies.delete(AUTH_COOKIE);
    return res;
  }

  if (!tokenValid && !isLoginPage) {
    const res = NextResponse.redirect(new URL("/login", req.url));
    res.cookies.delete(AUTH_COOKIE);
    return res;
  }

  if (tokenValid && isLoginPage) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
