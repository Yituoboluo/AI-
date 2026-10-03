import test from 'node:test';
import assert from 'node:assert/strict';
import { projectLangfuseSnapshot, exportJob, langfuseConnectionStatus } from '../server/langfuse.mjs';
import { createTestDatabase } from './langfuse-test-db.mjs';

const OWNER = 'owner-private-person@example.test';
const JOB = 'job-100';
const BASE = '2026-09-30T01:00:00.000Z';
const END = '2026-09-30T01:00:03.000Z';
const PRIVATE = 'PRIVATE-NOTE-NOT-FOR-LANGFUSE';
const SECRET = 'sk-secret-never-export';
const clone = x => structuredClone(x);
const event = (id, fields = {}) => ({
  id, owner_id: OWNER, project_id: 'project-100', task_id: 'task-100', job_id: JOB,
  trace_id: JOB, span_id: `span-${id}`, parent_span_id: JOB,
  name: 'image_generation_completed', stage: 'generate', status: 'succeeded',
  duration_ms: 3000, source: 'server', environment: 'production',
  occurred_at: END, received_at: END, data_json: '{}', ...fields,
});
const asset = (version, fields = {}) => ({
  id: `asset_${JOB}_v${version}_0`, owner_id: OWNER, job_id: JOB, task_id: 'task-100',
  version, output_index: 0, concept_id: 'concept-one', image_url: `/api/assets/private-${version}.png`,
  title: '标题', subtitle: '副标题', layout: 'left', metadata_json: '{}', created_at: END, ...fields,
});
const snapshot = (fields = {}) => ({
  owner: OWNER,
  job: {
    id: JOB, owner_id: OWNER, project_id: 'project-100', task_id: 'task-100',
    kind: 'image', source_revision: 1, source_version: 1, provider: 'image-provider',
    model: 'image-model-2.5', status: 'succeeded', attempt_no: 1, parent_job_id: null,
    input_fingerprint: 'fingerprint-one', environment: 'production', evaluation_json: null,
    workflow_version: 'creative-telemetry-v1', created_at: BASE, started_at: BASE, finished_at: END,
    input_json: JSON.stringify({prompt: PRIVATE, apiKey: SECRET, originalImageData: 'data:image/png;base64,SENSITIVEIMAGE', providerUrl: 'https://private.example/image?token=SECRETURL'}),
    result_json: '{}', usage_json: JSON.stringify({input_tokens: 999, output_tokens: 888, total_cost: 42}),
  },
  events: [], assets: [], feedback: [], reviews: [], badcases: [], regressions: [],
  ...fields,
});
const spans = projected => projected.items.filter(x => x.itemType === 'span');
const scores = projected => projected.items.filter(x => x.itemType === 'score');
const body = score => score.payload.body || score.payload;
function attributes(span) {
  return Object.fromEntries((span.payload.attributes || []).map(a => {
    const v = a.value || {};
    return [a.key, v.stringValue ?? v.intValue ?? v.doubleValue ?? v.boolValue ?? v.arrayValue ?? v.kvlistValue];
  }));
}
const contains = (obj, value) => JSON.stringify(obj).includes(value);
function findAssetSpan(projected, id) {
  return spans(projected).find(item => Object.values(attributes(item)).some(value => contains(value, id)));
}

test('projection creates deterministic valid OTLP identifiers and does not mutate its snapshot', async () => {
  const source = snapshot({events: [event('generation-one')], assets: [asset(1)]});
  const before = clone(source);
  const a = await projectLangfuseSnapshot(source);
  const b = await projectLangfuseSnapshot(clone(source));
  assert.deepEqual(source, before);
  assert.deepEqual(a, b);
  assert.match(a.traceId, /^[a-f0-9]{32}$/);
  assert.match(a.rootSpanId, /^[a-f0-9]{16}$/);
  assert.equal(new Set(a.items.map(x => x.id)).size, a.items.length);
  for (const item of spans(a)) {
    assert.equal(item.payload.traceId, a.traceId);
    assert.match(item.payload.spanId, /^[a-f0-9]{16}$/);
    assert.match(String(item.payload.startTimeUnixNano), /^\d+$/);
    assert.match(String(item.payload.endTimeUnixNano), /^\d+$/);
    assert.ok(BigInt(item.payload.endTimeUnixNano) >= BigInt(item.payload.startTimeUnixNano));
  }
});

test('root is zero-duration and is immutable when the job completes later', async () => {
  const pending = snapshot();
  pending.job.status = 'running'; pending.job.finished_at = null;
  const completed = clone(pending); completed.job.status = 'failed'; completed.job.finished_at = END;
  completed.job.error_code = 'DOWNSTREAM_FAILURE'; completed.job.error_message = PRIVATE;
  const p = await projectLangfuseSnapshot(pending);
  const c = await projectLangfuseSnapshot(completed);
  const pr = spans(p).find(x => x.payload.spanId === p.rootSpanId);
  const cr = spans(c).find(x => x.payload.spanId === c.rootSpanId);
  assert.ok(pr, 'a trace root must exist');
  assert.equal(pr.payload.startTimeUnixNano, pr.payload.endTimeUnixNano);
  assert.deepEqual(pr, cr, 'immutable OTLP root must not change as job state changes');
});

test('unfinished events are not exported; completed stages are siblings under root', async () => {
  const source = snapshot({events: [
    event('start-only', {name: 'image_download_started', stage: 'download', status: 'started', span_id: 'pending-span'}),
    event('plan-finish', {name: 'creative_plan_completed', stage: 'plan', span_id: 'plan-span'}),
    event('generation-finish', {span_id: 'image-span', parent_span_id: 'plan-span'}),
  ]});
  const p = await projectLangfuseSnapshot(source);
  const children = spans(p).filter(x => x.payload.spanId !== p.rootSpanId);
  assert.equal(children.length, 2);
  assert.ok(children.every(x => x.payload.parentSpanId === p.rootSpanId));
  assert.ok(children.every(x => !contains(x, 'start-only') && !contains(x, 'pending-span')));
});

test('production, evaluation and legacy remain distinct on every span', async () => {
  for (const environment of ['production', 'evaluation', 'legacy']) {
    const source = snapshot({events: [event('finish')], assets: [asset(1)]});
    source.job.environment = environment;
    source.job.evaluation_json = environment === 'evaluation' ? JSON.stringify({batchId: 'batch-100', caseId: 'C01', variant: 'A'}) : null;
    const p = await projectLangfuseSnapshot(source);
    assert.ok(spans(p).length >= 2);
    for (const span of spans(p)) assert.equal(attributes(span)['langfuse.environment'], environment);
  }
});

test('asset feedback scores attach to the exact versioned asset observation', async () => {
  const v1 = asset(1), v2 = asset(2);
  const source = snapshot({assets: [v1, v2]});
  for (const a of [v1, v2]) {
    const s = clone(source);
    s.feedback.push({id: `feedback-version-${a.version}`, owner_id: OWNER, job_id: JOB, task_id: 'task-100', asset_id: a.id, feedback: a.version === 1 ? 'rejected' : 'adopted', reason_code: 'COMPOSITION', note: PRIVATE, created_at: END, request_json: JSON.stringify({secret: SECRET})});
    const p = await projectLangfuseSnapshot(s);
    const target = findAssetSpan(p, a.id);
    assert.ok(target, `missing asset observation for v${a.version}`);
    assert.ok(scores(p).length > 0, 'feedback must project a score');
    for (const score of scores(p)) {
      assert.equal(body(score).traceId, p.traceId);
      assert.equal(body(score).observationId, target.payload.spanId);
      assert.equal(score.occurredAt, END);
      if (score.payload.timestamp) assert.equal(score.payload.timestamp, END);
    }
  }
});

test('automatic rules use a separate metric from human design quality', async () => {
  const a = asset(1);
  const source = snapshot({assets: [a], reviews: [{
    id: 'automatic-review-one', owner_id: OWNER, job_id: JOB, asset_id: a.id,
    kind: 'automatic', rubric_version: 'quality-v1', passed: 0, score: 75,
    report_json: JSON.stringify({checks: [{code: 'FILE_READABLE', label: '文件可读取', passed: true}, {code: 'OUTPUT_SIZE', label: '尺寸', passed: false}], scope: '文件、尺寸与文本规则；商品一致性、光影与设计感由人工评审'}), created_at: END,
  }]});
  const p = await projectLangfuseSnapshot(source);
  assert.ok(scores(p).length > 0);
  assert.ok(scores(p).some(x => body(x).value === 75));
  assert.ok(scores(p).every(x => !/design|aesthetic|设计评分|设计感得分/i.test(body(x).name)));
  const target = findAssetSpan(p, a.id);
  assert.ok(scores(p).every(x => body(x).observationId === target.payload.spanId));
});

test('projection strips raw prompts, owner identity, credentials, signed URLs and image bytes', async () => {
  const source = snapshot({
    events: [event('finish', {data_json: JSON.stringify({prompt: PRIVATE, errorMessage: PRIVATE, apiKey: SECRET, input: PRIVATE, imageUrl: 'https://private.example/image?token=SECRETURL', image: 'data:image/png;base64,SENSITIVEIMAGE'})})],
    assets: [asset(1, {title: PRIVATE, subtitle: PRIVATE, image_url: 'https://private.example/image?token=SECRETURL', metadata_json: JSON.stringify({token: SECRET})})],
  });
  const output = JSON.stringify(await projectLangfuseSnapshot(source));
  for (const secret of [OWNER, PRIVATE, SECRET, 'SECRETURL', 'SENSITIVEIMAGE', 'https://private.example']) assert.ok(!output.includes(secret), `output contained private marker ${secret}`);
});

test('unknown plan model, token counts and costs are not inferred from an image job', async () => {
  const source = snapshot({events: [
    event('plan-start', {name: 'creative_plan_started', stage: 'plan', status: 'started', span_id: 'plan-span', data_json: JSON.stringify({model: 'image-model-2.5'})}),
    event('plan-finish', {name: 'creative_plan_completed', stage: 'plan', span_id: 'plan-span', data_json: '{}'}),
  ]});
  const p = await projectLangfuseSnapshot(source);
  const stage = spans(p).find(x => x.payload.spanId !== p.rootSpanId);
  assert.ok(stage);
  const a = attributes(stage);
  assert.equal(a['langfuse.observation.model.name'], undefined);
  assert.equal(a['langfuse.observation.usage_details'], undefined);
  assert.equal(a['langfuse.observation.cost_details'], undefined);
});

test('projection ignores cross-tenant and unrelated-job child records', async () => {
  const clean = snapshot({events: [event('valid-event')], assets: [asset(1)]});
  const dirty = clone(clean);
  dirty.events.push(event('other-tenant-event', {owner_id: 'other-owner'}), event('other-job-event', {job_id: 'other-job'}));
  dirty.assets.push(asset(2, {owner_id: 'other-owner'}), asset(3, {job_id: 'other-job'}));
  dirty.feedback.push({id: 'foreign-feedback', owner_id: 'other-owner', job_id: JOB, asset_id: asset(1).id, feedback: 'adopted', created_at: END});
  dirty.reviews.push({id: 'foreign-review', owner_id: OWNER, job_id: 'other-job', asset_id: asset(1).id, kind: 'human', score: 8, passed: 1, created_at: END, report_json: '{}'});
  assert.deepEqual(await projectLangfuseSnapshot(dirty), await projectLangfuseSnapshot(clean));
});

test('Langfuse connection status reveals no credentials', () => {
  const ready = langfuseConnectionStatus({LANGFUSE_BASE_URL: 'https://cloud.langfuse.com', LANGFUSE_PUBLIC_KEY: 'pk-lf-test', LANGFUSE_SECRET_KEY: 'sk-lf-test-private'});
  assert.equal(ready.configured, true);
  assert.ok(ready.host.includes('cloud.langfuse.com'));
  assert.ok(!JSON.stringify(ready).includes('sk-lf-test-private'));
  assert.ok(!JSON.stringify(ready).includes('pk-lf-test'));
  assert.equal(langfuseConnectionStatus({}).configured, false);
});

function setupExport(t, source) {
  const db = createTestDatabase();
  t.after(() => db.close());
  db.insert('generation_jobs', source.job);
  for (const [field, table] of Object.entries({events:'telemetry_events', assets:'creative_assets', feedback:'asset_feedback', reviews:'quality_reviews', badcases:'quality_badcases', regressions:'quality_regressions'})) {
    for (const row of source[field]) db.insert(table, row);
  }
  return {db, env: {DB: db.DB, LANGFUSE_BASE_URL: 'https://cloud.langfuse.com', LANGFUSE_PUBLIC_KEY: 'pk-lf-test', LANGFUSE_SECRET_KEY: 'sk-lf-test-private'}};
}
function successfulIngestion(input) {
  const parsed = JSON.parse(input.body);
  if (parsed.batch) return Response.json({successes: parsed.batch.map(x => ({id:x.id,status:201})), errors:[]}, {status:207});
  return Response.json({});
}

test('disabled export makes no outbound request and no outbox records', async t => {
  const {db, env} = setupExport(t, snapshot());
  t.mock.method(globalThis, 'fetch', () => { throw new Error('unexpected outbound request'); });
  delete env.LANGFUSE_SECRET_KEY;
  const result = await exportJob(env, OWNER, JOB);
  assert.equal(result.status, 'disabled');
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM langfuse_exports').get().n, 0);
});

test('successful repeated exports are deduplicated by the durable outbox', async t => {
  const {db, env} = setupExport(t, snapshot({events:[event('generation-finish')]}));
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, input) => {requests.push({url:String(url), input}); return successfulIngestion(input);});
  const first = await exportJob(env, OWNER, JOB);
  assert.equal(first.status, 'ok');
  assert.ok(requests.length > 0);
  assert.ok(requests.some(x => x.url.endsWith('/api/public/otel/v1/traces')));
  const count = requests.length;
  const repeated = await exportJob(env, OWNER, JOB);
  assert.equal(repeated.status, 'ok');
  assert.equal(requests.length, count);
  const rows = db.sqlite.prepare('SELECT * FROM langfuse_exports').all();
  assert.ok(rows.length >= 2);
  assert.ok(rows.every(x => x.state === 'sent'));
});

test('parallel exports claim each immutable span only once', async t => {
  const {env} = setupExport(t, snapshot({events:[event('generation-finish')]}));
  const sentSpans = [];
  t.mock.method(globalThis, 'fetch', async (url, input) => {
    const payload = JSON.parse(input.body);
    for (const r of payload.resourceSpans || []) for (const s of r.scopeSpans || []) sentSpans.push(...(s.spans || []).map(x => x.spanId));
    await new Promise(resolve => setImmediate(resolve));
    return successfulIngestion(input);
  });
  await Promise.all([exportJob(env, OWNER, JOB), exportJob(env, OWNER, JOB), exportJob(env, OWNER, JOB)]);
  assert.ok(sentSpans.length >= 2);
  assert.equal(new Set(sentSpans).size, sentSpans.length, 'concurrent exporter sent an immutable span more than once');
});

test('ambiguous OTLP timeout is not blindly resent on the next export', async t => {
  const {db, env} = setupExport(t, snapshot());
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {requests++; throw new DOMException('timed out', 'TimeoutError');});
  await exportJob(env, OWNER, JOB);
  assert.ok(requests > 0);
  const firstCount = requests;
  db.sqlite.exec("UPDATE langfuse_exports SET next_retry_at='2000-01-01T00:00:00.000Z'");
  await exportJob(env, OWNER, JOB);
  assert.equal(requests, firstCount);
  const rows = db.sqlite.prepare("SELECT * FROM langfuse_exports WHERE item_type='span'").all();
  assert.ok(rows.length > 0);
  assert.ok(rows.every(x => x.state === 'uncertain'));
});

test('export cannot read or emit another owner’s job', async t => {
  const {db, env} = setupExport(t, snapshot());
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (_url, input) => {requests++; return successfulIngestion(input);});
  await exportJob(env, 'other-owner', JOB);
  assert.equal(requests, 0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM langfuse_exports').get().n, 0);
});

test('OTLP partial success remains uncertain because the rejected span IDs are unknown', async t => {
  const {db, env} = setupExport(t, snapshot({events:[event('generation-finish')]}));
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {requests++; return Response.json({partialSuccess:{rejectedSpans:'1',errorMessage:'one span rejected'}});});
  await exportJob(env, OWNER, JOB);
  const rows = db.sqlite.prepare("SELECT * FROM langfuse_exports WHERE item_type='span'").all();
  assert.ok(rows.length >= 2);
  assert.ok(rows.every(x => x.state === 'uncertain'));
  const count = requests;
  await exportJob(env, OWNER, JOB);
  assert.equal(requests, count);
});

test('score timeout is retryable without resending successfully delivered spans', async t => {
  const a = asset(1);
  const {db, env} = setupExport(t, snapshot({assets:[a], feedback:[{
    id:'feedback-one',owner_id:OWNER,job_id:JOB,task_id:'task-100',asset_id:a.id,feedback:'adopted',reason_code:'',note:'',created_at:END,request_json:'{}',
  }]}));
  let spanRequests = 0, scoreRequests = 0, mode = 'timeout';
  const scoreEventIds = [];
  t.mock.method(globalThis, 'fetch', async (url, input) => {
    if (String(url).endsWith('/otel/v1/traces')) {spanRequests++; return successfulIngestion(input);}
    scoreRequests++;
    scoreEventIds.push(JSON.parse(input.body).batch.map(x => x.id));
    if (mode === 'timeout') throw new DOMException('timed out', 'TimeoutError');
    return successfulIngestion(input);
  });
  await exportJob(env, OWNER, JOB);
  assert.ok(db.sqlite.prepare("SELECT * FROM langfuse_exports WHERE item_type='span'").all().every(x => x.state === 'sent'));
  assert.ok(db.sqlite.prepare("SELECT * FROM langfuse_exports WHERE item_type='score'").all().every(x => x.state === 'pending'));
  const initialSpanCount = spanRequests;
  mode = 'success';
  db.sqlite.exec("UPDATE langfuse_exports SET next_retry_at='2000-01-01T00:00:00.000Z'");
  await exportJob(env, OWNER, JOB);
  assert.equal(spanRequests, initialSpanCount);
  assert.equal(scoreRequests, 2);
  assert.deepEqual(scoreEventIds[1], scoreEventIds[0], 'retry must keep deterministic score/event IDs');
  assert.ok(db.sqlite.prepare('SELECT * FROM langfuse_exports').all().every(x => x.state === 'sent'));
});

test('HTTP 207 acknowledges score entries individually and retries only the missing score', async t => {
  const a = asset(1);
  const {db, env} = setupExport(t, snapshot({assets:[a], reviews:[{
    id:'review-one',owner_id:OWNER,job_id:JOB,asset_id:a.id,kind:'automatic',rubric_version:'quality-v1',passed:1,score:100,report_json:'{}',created_at:END,
  }]}));
  let first = true;
  const scoreBatches = [];
  t.mock.method(globalThis, 'fetch', async (url, input) => {
    if (String(url).endsWith('/otel/v1/traces')) return successfulIngestion(input);
    const batch = JSON.parse(input.body).batch;
    scoreBatches.push(batch.map(x => x.id));
    if (first) {first=false; return Response.json({successes:[{id:batch[0].id,status:201}],errors:[{id:batch[1].id,status:429,message:'rate limit'}]}, {status:207});}
    return successfulIngestion(input);
  });
  await exportJob(env, OWNER, JOB);
  const initialRows = db.sqlite.prepare("SELECT * FROM langfuse_exports WHERE item_type='score'").all();
  assert.equal(initialRows.filter(x => x.state === 'sent').length, 1);
  assert.equal(initialRows.filter(x => x.state === 'pending').length, 1);
  db.sqlite.exec("UPDATE langfuse_exports SET next_retry_at='2000-01-01T00:00:00.000Z'");
  await exportJob(env, OWNER, JOB);
  assert.equal(scoreBatches.length, 2);
  assert.deepEqual(scoreBatches[1], [scoreBatches[0][1]]);
  assert.ok(db.sqlite.prepare('SELECT * FROM langfuse_exports').all().every(x => x.state === 'sent'));
});

test('explicit HTTP 429 can be retried after backoff; immutable span IDs stay unchanged', async t => {
  const {db, env} = setupExport(t, snapshot());
  let first = true;
  const bodies = [];
  t.mock.method(globalThis, 'fetch', async (_url, input) => {
    bodies.push(input.body);
    if (first) {first=false; return Response.json({message:'rate limited'},{status:429});}
    return successfulIngestion(input);
  });
  await exportJob(env, OWNER, JOB);
  assert.ok(db.sqlite.prepare('SELECT * FROM langfuse_exports').all().every(x => x.state === 'pending'));
  await exportJob(env, OWNER, JOB);
  assert.equal(bodies.length, 1, 'backoff should prevent an immediate retry');
  db.sqlite.exec("UPDATE langfuse_exports SET next_retry_at='2000-01-01T00:00:00.000Z'");
  await exportJob(env, OWNER, JOB);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0], bodies[1]);
});

test('HTTP 401 blocks retries and upstream error text is not copied into the ledger', async t => {
  const {db, env} = setupExport(t, snapshot());
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {requests++; return Response.json({message:SECRET},{status:401});});
  await exportJob(env, OWNER, JOB);
  const rows = db.sqlite.prepare('SELECT * FROM langfuse_exports').all();
  assert.ok(rows.every(x => x.state === 'blocked'));
  assert.ok(!JSON.stringify(rows).includes(SECRET));
  await exportJob(env, OWNER, JOB);
  assert.equal(requests, 1);
});

test('export errors fail open without exposing exception details', async t => {
  const env = {DB:{prepare() {throw new Error(SECRET);}},LANGFUSE_BASE_URL:'https://cloud.langfuse.com',LANGFUSE_PUBLIC_KEY:'pk-lf-test',LANGFUSE_SECRET_KEY:'sk-lf-test'};
  t.mock.method(globalThis, 'fetch', () => {throw new Error('unexpected request');});
  const result = await exportJob(env, OWNER, JOB);
  assert.equal(result.status, 'error');
  assert.ok(!JSON.stringify(result).includes(SECRET));
});
