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

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const profile = await prisma.mappingProfile.findFirst({ where: { id, userId: session.uid } });
    if (!profile) return fail("配置不存在", 404);
    return ok({
      ...profile,
      headers: parseJson(profile.headers, {}),
      inputBindings: parseJson(profile.inputBindings, []),
      extractRules: parseJson(profile.extractRules, []),
      expectedSchema: parseJson(profile.expectedSchema, null),
      doneRules: parseJson(profile.doneRules, []),
    });
  } catch {
    return fail("未登录", 401);
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) return fail("配置参数不合法", 400);

    const profile = await prisma.mappingProfile.updateMany({
      where: { id, userId: session.uid },
      data: {
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

    if (profile.count === 0) return fail("配置不存在", 404);
    return ok({ id });
  } catch {
    return fail("更新失败", 500);
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const target = await prisma.mappingProfile.findFirst({ where: { id, userId: session.uid } });
    if (!target) return fail("配置不存在", 404);
    await prisma.mappingProfile.delete({ where: { id } });
    return ok({ id });
  } catch {
    return fail("删除失败", 500);
  }
}
