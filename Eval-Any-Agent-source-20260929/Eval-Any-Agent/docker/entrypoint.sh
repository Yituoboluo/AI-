#!/bin/sh
set -eu

APP_PORT="${APP_PORT:-3000}"
DATABASE_URL="${DATABASE_URL:-file:/app/data/dev.db}"
SCHEDULER_SECRET="${SCHEDULER_SECRET:-change-this-scheduler-secret}"
export DATABASE_URL
export SCHEDULER_SECRET
export DISABLE_SCHEDULER=true

case "$DATABASE_URL" in
  file:*)
    DB_PATH="${DATABASE_URL#file:}"
    DB_PATH="${DB_PATH%%\?*}"
    case "$DB_PATH" in
      /*) ;;
      *) DB_PATH="/app/prisma/$DB_PATH" ;;
    esac
    ;;
  *)
    echo "[entrypoint] unsupported DATABASE_URL for bundled SQLite init: ${DATABASE_URL}" >&2
    exit 1
    ;;
esac

if [ ! -f "$DB_PATH" ] || [ "$(sqlite3 "$DB_PATH" "SELECT name FROM sqlite_master WHERE type='table' AND name='User';")" != "User" ]; then
  echo "[entrypoint] missing SQLite schema, initializing database at ${DB_PATH}..."
  mkdir -p "$(dirname "$DB_PATH")"
  sqlite3 "$DB_PATH" < /app/prisma/init.sql

  echo "[entrypoint] seeding default admin..."
  node <<'NODE'
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

async function main() {
  const prisma = new PrismaClient();
  const username = process.env.DEFAULT_ADMIN_USERNAME || "admin";
  const password = process.env.DEFAULT_ADMIN_PASSWORD || "admin";

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    console.log("[entrypoint] admin already exists");
    await prisma.$disconnect();
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({
    data: {
      username,
      passwordHash,
    },
  });
  console.log("[entrypoint] seeded default admin user");
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE
fi

if [ "$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM pragma_table_info('EvalTask') WHERE name='conversationIdMode';")" = "0" ]; then
  echo "[entrypoint] adding conversation ID strategy columns..."
  sqlite3 "$DB_PATH" 'ALTER TABLE "EvalTask" ADD COLUMN "conversationIdMode" TEXT NOT NULL DEFAULT "preserve"; ALTER TABLE "EvalTask" ADD COLUMN "conversationIdEvery" INTEGER NOT NULL DEFAULT 1;'
fi

if [ "$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM pragma_table_info('ScheduledTask') WHERE name='conversationIdMode';")" = "0" ]; then
  echo "[entrypoint] adding scheduled conversation ID strategy columns..."
  sqlite3 "$DB_PATH" 'ALTER TABLE "ScheduledTask" ADD COLUMN "conversationIdMode" TEXT NOT NULL DEFAULT "preserve"; ALTER TABLE "ScheduledTask" ADD COLUMN "conversationIdEvery" INTEGER NOT NULL DEFAULT 1;'
fi

if [ "$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM pragma_table_info('Evaluator') WHERE name='thinkingEnabled';")" = "0" ]; then
  echo "[entrypoint] adding missing Evaluator.thinkingEnabled column..."
  sqlite3 "$DB_PATH" 'ALTER TABLE "Evaluator" ADD COLUMN "thinkingEnabled" BOOLEAN NOT NULL DEFAULT false;'
fi

if [ "$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM pragma_table_info('Evaluator') WHERE name='notifyDingTalk';")" = "0" ]; then
  echo "[entrypoint] adding Evaluator.notifyDingTalk column..."
  sqlite3 "$DB_PATH" 'ALTER TABLE "Evaluator" ADD COLUMN "notifyDingTalk" BOOLEAN NOT NULL DEFAULT false;'
fi

if [ "$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM pragma_table_info('EvaluationTask') WHERE name='notifyDingTalk';")" = "0" ]; then
  echo "[entrypoint] adding EvaluationTask.notifyDingTalk column..."
  sqlite3 "$DB_PATH" 'ALTER TABLE "EvaluationTask" ADD COLUMN "notifyDingTalk" BOOLEAN NOT NULL DEFAULT false;'
fi

if [ "$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM pragma_table_info('ScheduledTask') WHERE name='notifyDingTalk';")" = "0" ]; then
  echo "[entrypoint] adding ScheduledTask.notifyDingTalk column..."
  sqlite3 "$DB_PATH" 'ALTER TABLE "ScheduledTask" ADD COLUMN "notifyDingTalk" BOOLEAN NOT NULL DEFAULT true;'
fi

if [ "$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='ScheduledTask';")" = "0" ]; then
  echo "[entrypoint] adding ScheduledTask table..."
  sqlite3 "$DB_PATH" <<'SQL'
CREATE TABLE "ScheduledTask" (
  "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "name" TEXT NOT NULL,
  "datasetId" TEXT NOT NULL, "profileId" TEXT NOT NULL, "concurrency" INTEGER NOT NULL DEFAULT 20,
  "timeoutMs" INTEGER NOT NULL DEFAULT 60000, "retryCount" INTEGER NOT NULL DEFAULT 2,
  "scheduleType" TEXT NOT NULL, "cronExpr" TEXT, "intervalMs" INTEGER,
  "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai', "notifyDingTalk" BOOLEAN NOT NULL DEFAULT true,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "lastRunAt" DATETIME, "nextRunAt" DATETIME NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ScheduledTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ScheduledTask_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ScheduledTask_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "MappingProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ScheduledTask_userId_enabled_nextRunAt_idx" ON "ScheduledTask"("userId", "enabled", "nextRunAt");
SQL
fi

echo "[entrypoint] starting Next.js on port ${APP_PORT}..."
npm run start -- -p "${APP_PORT}" &
APP_PID=$!

echo "[entrypoint] starting scheduler loop..."
(
  while kill -0 "$APP_PID" 2>/dev/null; do
    sleep 30
    curl -fsS -X POST "http://127.0.0.1:${APP_PORT}/api/scheduler/tick" -H "x-scheduler-secret: ${SCHEDULER_SECRET}" >/dev/null || true
  done
) &

wait "$APP_PID"
