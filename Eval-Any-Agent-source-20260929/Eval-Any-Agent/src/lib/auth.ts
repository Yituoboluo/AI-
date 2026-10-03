import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/password";

const COOKIE_NAME = "eval_agent_session";

function getAuthSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET is required in production");
  }
  return new TextEncoder().encode(secret || "local-dev-auth-secret");
}

type SessionPayload = {
  uid: string;
  username: string;
};

export async function ensureDefaultAdmin() {
  const username = process.env.DEFAULT_ADMIN_USERNAME || "admin";
  const password = process.env.DEFAULT_ADMIN_PASSWORD || "admin";

  const exists = await prisma.user.findUnique({ where: { username } });
  if (exists) return;

  await prisma.user.create({
    data: {
      username,
      passwordHash: await hashPassword(password),
    },
  });
}

export async function login(username: string, password: string): Promise<boolean> {
  await ensureDefaultAdmin();
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) return false;

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return false;

  const token = await new SignJWT({ uid: user.id, username: user.username })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getAuthSecret());

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return true;
}

export async function logout() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getAuthSecret());
    if (!payload.uid || !payload.username) return null;
    const uid = String(payload.uid);
    const username = String(payload.username);
    const user = await prisma.user.findUnique({
      where: { id: uid },
      select: { id: true, username: true },
    });
    if (!user) {
      cookieStore.delete(COOKIE_NAME);
      return null;
    }
    return { uid: user.id, username: user.username || username };
  } catch {
    cookieStore.delete(COOKIE_NAME);
    return null;
  }
}

export async function requireSession() {
  const session = await getSession();
  if (!session) {
    throw new Error("UNAUTHORIZED");
  }
  return session;
}
