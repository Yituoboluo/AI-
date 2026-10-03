import { NextResponse } from "next/server";
import { tick } from "@/lib/scheduler";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const secret = process.env.SCHEDULER_SECRET;
  if (!secret || req.headers.get("x-scheduler-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  try {
    await tick();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[scheduler] tick failed", error);
    return NextResponse.json({ ok: false, error: "tick failed" }, { status: 500 });
  }
}
