import { prisma } from "@/lib/prisma";
import { runEvalTask } from "@/lib/execution";
import { runEvaluationTask } from "@/lib/evaluation";

let started = false;

type ScheduleDefinition = {
  scheduleType: string;
  intervalMs?: number | null;
  cronExpr?: string | null;
  timezone?: string | null;
};

function getZonedDateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute"), second: value("second") };
}

function zonedDateTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string) {
  const targetWallClock = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let timestamp = targetWallClock;
  for (let index = 0; index < 3; index += 1) {
    const observed = getZonedDateParts(new Date(timestamp), timeZone);
    const observedWallClock = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute, observed.second, 0);
    timestamp += targetWallClock - observedWallClock;
  }
  return new Date(timestamp);
}

export function nextRun(s: ScheduleDefinition, from = new Date()) {
  if (s.scheduleType === "interval") return new Date(from.getTime() + (s.intervalMs ?? 0));
  const m = s.cronExpr?.trim().match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+([0-7]|\*)$/);
  if (!m || Number(m[1]) > 59 || Number(m[2]) > 23) throw new Error("Cron 格式仅支持：分 时 * * 星期");
  const timeZone = s.timezone || "Asia/Shanghai";
  const localNow = getZonedDateParts(from, timeZone);
  const weekday = m[3] === "*" ? null : Number(m[3]) % 7;
  for (let dayOffset = 0; dayOffset < 370; dayOffset += 1) {
    const calendarDay = new Date(Date.UTC(localNow.year, localNow.month - 1, localNow.day + dayOffset));
    if (weekday !== null && calendarDay.getUTCDay() !== weekday) continue;
    const candidate = zonedDateTimeToUtc(
      calendarDay.getUTCFullYear(),
      calendarDay.getUTCMonth() + 1,
      calendarDay.getUTCDate(),
      Number(m[2]),
      Number(m[1]),
      timeZone,
    );
    if (candidate > from) return candidate;
  }
  throw new Error("无法计算下一次执行时间");
}
export async function tick() {
  const now = new Date();
  for (const s of await prisma.scheduledTask.findMany({ where: { enabled: true, nextRunAt: { lte: now } } })) {
    const claimed = await prisma.scheduledTask.updateMany({ where: { id: s.id, enabled: true, nextRunAt: s.nextRunAt }, data: { lastRunAt: now, nextRunAt: nextRun(s, now) } });
    if (!claimed.count) continue;
    const task = await prisma.evalTask.create({ data: { userId: s.userId, datasetId: s.datasetId, profileId: s.profileId, status: "queued", concurrency: s.concurrency, timeoutMs: s.timeoutMs, retryCount: s.retryCount, conversationIdMode: s.conversationIdMode, conversationIdEvery: s.conversationIdEvery, totalRows: (await prisma.dataset.findUniqueOrThrow({ where: { id: s.datasetId }, select: { rowCount: true } })).rowCount } });
    runScheduledTask(task.id, s.userId, s.notifyDingTalk).catch(console.error);
  }
}

async function runScheduledTask(taskId: string, userId: string, notifyDingTalk: boolean) {
  await runEvalTask(taskId);
  const evaluator = await prisma.evaluator.findFirst({
    where: { userId, enabled: true },
    orderBy: { createdAt: "desc" },
  });
  if (!evaluator) {
    console.warn(`[scheduler] task ${taskId} completed without an enabled evaluator`);
    return;
  }
  const sourceTask = await prisma.evalTask.findUnique({ where: { id: taskId }, select: { totalRows: true } });
  if (!sourceTask) return;
  const evaluationTask = await prisma.evaluationTask.create({
    data: { userId, sourceTaskId: taskId, evaluatorId: evaluator.id, status: "queued", totalRows: sourceTask.totalRows, notifyDingTalk },
  });
  await runEvaluationTask(evaluationTask.id);
}
export function startScheduler() { if (started || process.env.DISABLE_SCHEDULER === "true") return; started = true; setInterval(() => tick().catch(console.error), 30_000); tick().catch(console.error); }
