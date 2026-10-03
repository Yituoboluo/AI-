import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { isReviewSameOrigin, ReviewError, saveReview, validateReview } from "../src/lib/manual-review";
import { collectEvidence, readEvidenceFile } from "../src/lib/review-evidence";

const reviewBody = (overrides: Record<string, unknown> = {}) => ({ submissionKey: randomUUID(), expectedVersion: 0, verdict: "incorrect", reason: "原图标签支持该商品事实，AI 理由遗漏了证据。", correctedScore: 100, correctedPassed: true, ...overrides });
const hasStatus = (status: number) => (error: unknown) => error instanceof ReviewError && error.status === status;

async function removeTestDirectory(dir: string) {
  assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
  assert.match(path.basename(dir), /^eval-(manual-review|review-evidence)-/);
  await rm(dir, { recursive: true, force: true });
}

test("manual reviews preserve AI scores, retain history, and enforce access/version/idempotency", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "eval-manual-review-"));
  const db = new PrismaClient({ datasourceUrl: `file:${path.join(dir, "test.db").replaceAll("\\", "/")}` });
  try {
    const sql = await readFile(path.resolve("prisma/init.sql"), "utf8");
    for (const statement of sql.split(";").map((part) => part.trim()).filter(Boolean)) await db.$executeRawUnsafe(statement);
    const user = await db.user.create({ data: { username: "review-test-owner", passwordHash: "test-only" } });
    const other = await db.user.create({ data: { username: "review-test-other", passwordHash: "test-only" } });
    const dataset = await db.dataset.create({ data: { userId: user.id, name: "fixture", fileType: "json", rowCount: 1, columns: "[]", rows: "[]" } });
    const profile = await db.mappingProfile.create({ data: { userId: user.id, name: "fixture", upstreamUrl: "http://127.0.0.1/unused", requestTemplate: "{}", headers: "{}", inputBindings: "[]", extractRules: "[]", doneRules: "[]" } });
    const source = await db.evalTask.create({ data: { userId: user.id, datasetId: dataset.id, profileId: profile.id, status: "completed", concurrency: 1, timeoutMs: 1000, retryCount: 0, totalRows: 1 } });
    const sourceResult = await db.evalResult.create({ data: { taskId: source.id, rowIndex: 0, inputData: "{}", outputs: "{}", status: "success" } });
    const provider = await db.llmProviderConfig.create({ data: { userId: user.id, name: "never-called", baseUrl: "http://127.0.0.1/unused", apiKeyEncrypted: "unused", defaultModel: "unused" } });
    const evaluator = await db.evaluator.create({ data: { userId: user.id, providerConfigId: provider.id, name: "fixture", model: "unused", systemPrompt: "fixture", userPromptTemplate: "fixture", scoreMin: 0, scoreMax: 100 } });
    const task = await db.evaluationTask.create({ data: { userId: user.id, sourceTaskId: source.id, evaluatorId: evaluator.id, status: "completed", totalRows: 1, avgScore: 80 } });
    const result = await db.evaluationResult.create({ data: { evaluationTaskId: task.id, sourceResultId: sourceResult.id, rowIndex: 0, score: 80, passed: false, reason: "original AI reason", status: "success", promptSnapshot: "{}", rawResponse: "original raw response" } });
    const body = reviewBody();
    const first = await saveReview(db, result.id, user.id, body);
    assert.equal(first.revision, 1);
    assert.equal(first.reviewer.username, user.username);
    assert.equal(first.aiScore, 80);
    assert.equal(first.aiPassed, false);
    const duplicate = await saveReview(db, result.id, user.id, body);
    assert.equal(duplicate.id, first.id);
    assert.equal(await db.evaluationReview.count(), 1);
    await assert.rejects(saveReview(db, result.id, other.id, reviewBody()), hasStatus(404));
    await assert.rejects(saveReview(db, "missing", user.id, reviewBody()), hasStatus(404));
    await assert.rejects(saveReview(db, result.id, user.id, reviewBody()), hasStatus(409));
    await assert.rejects(saveReview(db, result.id, user.id, { ...body, reason: "changed retry" }), hasStatus(409));
    const second = await saveReview(db, result.id, user.id, reviewBody({ expectedVersion: 1, verdict: "uncertain", reason: "补充证据后再决定。", correctedScore: null, correctedPassed: null }));
    assert.equal(second.revision, 2);
    const stored = await db.evaluationResult.findUniqueOrThrow({ where: { id: result.id }, include: { reviews: { orderBy: { revision: "asc" } } } });
    assert.equal(stored.reviewVerdict, "uncertain");
    assert.equal(stored.reviewVersion, 2);
    assert.deepEqual(stored.reviews.map((record) => record.verdict), ["incorrect", "uncertain"]);
    assert.equal(stored.score, 80);
    assert.equal(stored.passed, false);
    assert.equal(stored.reason, "original AI reason");
    assert.equal(stored.rawResponse, "original raw response");
    assert.equal((await db.evaluationTask.findUniqueOrThrow({ where: { id: task.id } })).avgScore, 80);
    assert.equal(await db.evaluationResult.count({ where: { evaluationTaskId: task.id, reviewVerdict: "incorrect" } }), 0);
    assert.equal(await db.evaluationResult.count({ where: { evaluationTaskId: task.id, reviewVerdict: "uncertain" } }), 1);
  } finally { await db.$disconnect(); await removeTestDirectory(dir); }
});

test("review validation rejects invalid judgments and corrections", () => {
  for (const overrides of [
    { verdict: "approve" }, { reason: "  " }, { reason: "a".repeat(4001) }, { submissionKey: "invalid" },
    { expectedVersion: -1 }, { expectedVersion: 0.5 }, { correctedScore: 101 }, { correctedScore: -1 },
    { correctedScore: NaN }, { correctedPassed: "yes" }, { verdict: "correct", correctedScore: 100 },
    { verdict: "uncertain", correctedScore: null, correctedPassed: true },
  ]) assert.throws(() => validateReview(reviewBody(overrides), 0, 100), hasStatus(400));
  assert.equal(validateReview(reviewBody({ reason: "  依据明确  " }), 0, 100).reason, "依据明确");
});

test("origin validation uses the browser-facing Host and rejects other origins", () => {
  const request = (origin: string) => new Request("http://localhost:3000/api/reviews", { headers: { host: "127.0.0.1:3000", origin } });
  assert.equal(isReviewSameOrigin(request("http://127.0.0.1:3000")), true);
  assert.equal(isReviewSameOrigin(request("http://evil.invalid")), false);
  assert.equal(isReviewSameOrigin(request("http://127.0.0.1:3001")), false);
  assert.equal(isReviewSameOrigin(request("https://127.0.0.1:3000")), false);
  assert.equal(isReviewSameOrigin(request("null")), false);
});

test("local image evidence checks recorded keys, paths, file type, hash, and symlink escapes", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "eval-review-evidence-"));
  const allowed = path.join(dir, "allowed");
  await mkdir(allowed);
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aW6cAAAAASUVORK5CYII=", "base64");
  const file = path.join(allowed, "image.png");
  const outside = path.join(dir, "outside.png");
  await writeFile(file, bytes); await writeFile(outside, bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  try {
    const files = collectEvidence(JSON.stringify({ asset_path: file, asset_sha256: sha256 }), JSON.stringify({ "实际输出": { assets: [{ local_path: file, sha256, name: "成品" }] } }));
    assert.deepEqual(files.map((image) => image.key), ["input", "asset-0"]);
    const read = await readEvidenceFile(files[0], [allowed]);
    assert.equal(read.contentType, "image/png"); assert.deepEqual(read.bytes, bytes);
    await assert.rejects(readEvidenceFile({ ...files[0], filePath: outside }, [allowed]), hasStatus(403));
    await assert.rejects(readEvidenceFile({ ...files[0], sha256: "0".repeat(64) }, [allowed]), hasStatus(409));
    await assert.rejects(readEvidenceFile({ ...files[0], filePath: path.join(allowed, "missing.png") }, [allowed]), hasStatus(404));
    const fake = path.join(allowed, "fake.png"); await writeFile(fake, "not an image");
    await assert.rejects(readEvidenceFile({ ...files[0], filePath: fake, sha256: undefined }, [allowed]), hasStatus(415));
    const link = path.join(allowed, "escape");
    await symlink(dir, link, "junction");
    await assert.rejects(readEvidenceFile({ ...files[0], filePath: path.join(link, "outside.png") }, [allowed]), hasStatus(403));
    assert.deepEqual(collectEvidence({}, { "实际输出": { assets: [] } }), []);
  } finally { await removeTestDirectory(dir); }
});
