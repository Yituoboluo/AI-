import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { parseJson, stringifyJson } from "@/lib/json";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  name: z.string().min(1),
  upstreamUrl: z.string().url(),
  method: z.string().default("POST"),
  requestTemplate: z.string().min(2),
  headers: z.record(z.string(), z.string()).default({}),
  inputBindings: z.array(z.object({ placeholder: z.string(), column: z.string() })).default([]),
  extractRules: z
    .array(
      z.object({
        key: z.string().trim().min(1),
        path: z.string().trim().min(1).refine((value) => value !== "$.", {
          message: 'JSONPath 不能是 "$."',
        }),
        mode: z.enum(["text", "json"]).default("text"),
      }),
    )
    .default([]),
  expectedSchema: z.any().optional(),
  streamProtocol: z.enum(["auto", "sse", "ndjson", "plain_text"]).default("auto"),
  doneStrategy: z.enum(["auto", "manual"]).default("auto"),
  doneRules: z.array(z.any()).default([]),
  doneRequired: z.boolean().default(false),
  timeoutMs: z.number().int().positive().default(60000),
  retryCount: z.number().int().min(0).max(5).default(2),
  idleTimeoutMs: z.number().int().positive().default(15000),
});

export async function GET() {
  try {
    const session = await requireSession();
    const list = await prisma.mappingProfile.findMany({
      where: { userId: session.uid },
      orderBy: { createdAt: "desc" },
    });
    return ok(
      list.map((item) => ({
        ...item,
        headers: parseJson<Record<string, string>>(item.headers, {}),
        inputBindings: parseJson<Array<{ placeholder: string; column: string }>>(item.inputBindings, []),
        extractRules: parseJson<Array<{ key: string; path: string; mode?: "text" | "json" }>>(item.extractRules, []),
        expectedSchema: parseJson(item.expectedSchema, null),
        doneRules: parseJson(item.doneRules, []),
      })),
    );
  } catch {
    return fail("未登录", 401);
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) return fail("配置参数不合法", 400);

    const profile = await prisma.mappingProfile.create({
      data: {
        userId: session.uid,
        name: parsed.data.name,
        upstreamUrl: parsed.data.upstreamUrl,
        method: parsed.data.method,
        requestTemplate: parsed.data.requestTemplate,
        headers: stringifyJson(parsed.data.headers),
        inputBindings: stringifyJson(parsed.data.inputBindings),
        extractRules: stringifyJson(parsed.data.extractRules),
        expectedSchema: parsed.data.expectedSchema ? stringifyJson(parsed.data.expectedSchema) : null,
        streamProtocol: parsed.data.streamProtocol,
        doneStrategy: parsed.data.doneStrategy,
        doneRules: stringifyJson(parsed.data.doneRules),
        doneRequired: parsed.data.doneRequired,
        timeoutMs: parsed.data.timeoutMs,
        retryCount: parsed.data.retryCount,
        idleTimeoutMs: parsed.data.idleTimeoutMs,
      },
    });

    return ok({
      ...profile,
      headers: parseJson(profile.headers, {}),
      inputBindings: parseJson(profile.inputBindings, []),
      extractRules: parseJson(profile.extractRules, []),
      expectedSchema: parseJson(profile.expectedSchema, null),
      doneRules: parseJson(profile.doneRules, []),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return fail("未登录", 401);
    return fail("创建失败", 500);
  }
}
