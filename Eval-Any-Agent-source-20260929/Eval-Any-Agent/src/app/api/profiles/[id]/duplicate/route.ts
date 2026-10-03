import { requireSession } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";

function buildDuplicateName(baseName: string, existingNames: string[]) {
  const trimmedBaseName = baseName.trim() || "未命名配置";
  const preferredName = `${trimmedBaseName} 副本`;

  if (!existingNames.includes(preferredName)) return preferredName;

  let index = 2;
  while (existingNames.includes(`${trimmedBaseName} 副本 ${index}`)) {
    index += 1;
  }

  return `${trimmedBaseName} 副本 ${index}`;
}

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;

    const profile = await prisma.mappingProfile.findFirst({
      where: { id, userId: session.uid },
    });
    if (!profile) return fail("配置不存在", 404);

    const siblingProfiles = await prisma.mappingProfile.findMany({
      where: { userId: session.uid },
      select: { name: true },
    });
    const duplicateName = buildDuplicateName(
      profile.name,
      siblingProfiles.map((item) => item.name),
    );

    const duplicatedProfile = await prisma.mappingProfile.create({
      data: {
        userId: session.uid,
        datasetId: profile.datasetId,
        name: duplicateName,
        upstreamUrl: profile.upstreamUrl,
        method: profile.method,
        requestTemplate: profile.requestTemplate,
        headers: profile.headers,
        inputBindings: profile.inputBindings,
        extractRules: profile.extractRules,
        expectedSchema: profile.expectedSchema,
        streamProtocol: profile.streamProtocol,
        doneStrategy: profile.doneStrategy,
        doneRules: profile.doneRules,
        doneRequired: profile.doneRequired,
        timeoutMs: profile.timeoutMs,
        retryCount: profile.retryCount,
        idleTimeoutMs: profile.idleTimeoutMs,
      },
    });

    return ok(duplicatedProfile);
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") return fail("未登录", 401);
    return fail("创建副本失败", 500);
  }
}
