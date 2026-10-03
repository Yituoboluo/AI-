import {sqliteTable,text,integer,index} from 'drizzle-orm/sqlite-core';

export const projects=sqliteTable('projects',{
  id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),name:text('name').notNull(),
  draftJson:text('draft_json').notNull(),imageKey:text('image_key'),backgroundKey:text('background_key'),thumbnailKey:text('thumbnail_key'),
  version:integer('version').notNull().default(1),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull()
},t=>[index('idx_projects_owner_updated').on(t.ownerId,t.updatedAt)]);

export const jobs=sqliteTable('generation_jobs',{
  id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),projectId:text('project_id').notNull(),kind:text('kind').notNull(),
  sourceRevision:integer('source_revision').notNull(),sourceVersion:integer('source_version').notNull(),
  provider:text('provider').notNull(),model:text('model').notNull(),status:text('status').notNull(),
  inputJson:text('input_json').notNull(),resultJson:text('result_json'),errorCode:text('error_code'),errorMessage:text('error_message'),
  usageJson:text('usage_json'),createdAt:text('created_at').notNull(),startedAt:text('started_at'),finishedAt:text('finished_at'),
  feedback:text('feedback'),feedbackReason:text('feedback_reason'),feedbackAt:text('feedback_at'),
  taskId:text('task_id'),parentJobId:text('parent_job_id'),attemptNo:integer('attempt_no'),
  inputFingerprint:text('input_fingerprint'),environment:text('environment').notNull().default('legacy'),
  evaluationJson:text('evaluation_json'),workflowVersion:text('workflow_version')
},t=>[index('idx_jobs_owner_created').on(t.ownerId,t.createdAt),index('idx_jobs_owner_project').on(t.ownerId,t.projectId),index('idx_jobs_owner_task').on(t.ownerId,t.taskId)]);

export const quota=sqliteTable('daily_quota',{
  id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),day:text('day').notNull(),kind:text('kind').notNull(),used:integer('used').notNull().default(0)
});

export const events=sqliteTable('workspace_events',{
  id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),projectId:text('project_id').notNull(),kind:text('kind').notNull(),
  revision:integer('revision').notNull(),payloadJson:text('payload_json').notNull(),createdAt:text('created_at').notNull()
},t=>[index('idx_events_owner_created').on(t.ownerId,t.createdAt)]);

export const telemetryEvents=sqliteTable('telemetry_events',{
  id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),projectId:text('project_id').notNull(),
  taskId:text('task_id'),jobId:text('job_id'),assetId:text('asset_id'),assetVersion:integer('asset_version'),
  inputRevision:integer('input_revision'),traceId:text('trace_id').notNull(),spanId:text('span_id'),parentSpanId:text('parent_span_id'),
  name:text('name').notNull(),stage:text('stage').notNull(),status:text('status').notNull(),
  durationMs:integer('duration_ms'),source:text('source').notNull(),environment:text('environment').notNull(),
  occurredAt:text('occurred_at').notNull(),receivedAt:text('received_at').notNull(),dataJson:text('data_json').notNull()
},t=>[index('idx_telemetry_owner_job').on(t.ownerId,t.jobId,t.receivedAt),index('idx_telemetry_owner_project').on(t.ownerId,t.projectId,t.receivedAt)]);

export const creativeAssets=sqliteTable('creative_assets',{
  id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),jobId:text('job_id').notNull(),taskId:text('task_id'),
  version:integer('version').notNull(),outputIndex:integer('output_index').notNull(),conceptId:text('concept_id'),
  imageUrl:text('image_url').notNull(),title:text('title').notNull(),subtitle:text('subtitle').notNull(),
  layout:text('layout').notNull(),metadataJson:text('metadata_json').notNull(),createdAt:text('created_at').notNull()
},t=>[index('idx_assets_owner_job_version').on(t.ownerId,t.jobId,t.version)]);

export const assetFeedback=sqliteTable('asset_feedback',{
  id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),assetId:text('asset_id').notNull(),
  jobId:text('job_id').notNull(),taskId:text('task_id'),feedback:text('feedback').notNull(),
  reasonCode:text('reason_code').notNull(),note:text('note').notNull(),createdAt:text('created_at').notNull(),
  requestJson:text('request_json').notNull()
},t=>[index('idx_feedback_owner_asset').on(t.ownerId,t.assetId,t.createdAt),index('idx_feedback_owner_task').on(t.ownerId,t.taskId,t.createdAt)]);

export const qualityReviews=sqliteTable('quality_reviews',{
  id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),jobId:text('job_id').notNull(),assetId:text('asset_id'),
  kind:text('kind').notNull(),rubricVersion:text('rubric_version').notNull(),passed:integer('passed'),
  score:integer('score'),reportJson:text('report_json').notNull(),createdAt:text('created_at').notNull()
},t=>[index('idx_reviews_owner_job').on(t.ownerId,t.jobId,t.createdAt),index('idx_reviews_owner_asset').on(t.ownerId,t.assetId,t.createdAt)]);

export const qualityBadcases=sqliteTable('quality_badcases',{
  id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),jobId:text('job_id').notNull(),assetId:text('asset_id'),
  kind:text('kind').notNull(),stage:text('stage').notNull(),code:text('code').notNull(),title:text('title').notNull(),
  status:text('status').notNull().default('open'),evidenceJson:text('evidence_json').notNull(),
  hypothesis:text('hypothesis').notNull().default(''),fix:text('fix').notNull().default(''),
  version:integer('version').notNull().default(1),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),closedAt:text('closed_at')
},t=>[index('idx_badcases_owner_status').on(t.ownerId,t.status,t.createdAt)]);

export const qualityRegressions=sqliteTable('quality_regressions',{
  id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),badcaseId:text('badcase_id').notNull(),
  jobId:text('job_id').notNull(),assetId:text('asset_id'),outcome:text('outcome').notNull(),
  reportJson:text('report_json').notNull(),requestJson:text('request_json').notNull(),createdAt:text('created_at').notNull()
},t=>[index('idx_regressions_owner_case').on(t.ownerId,t.badcaseId,t.createdAt)]);

export const langfuseExports=sqliteTable('langfuse_exports',{
 id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),jobId:text('job_id').notNull(),
 itemType:text('item_type').notNull(),state:text('state').notNull().default('pending'),payloadJson:text('payload_json').notNull(),
 occurredAt:text('occurred_at').notNull(),attempts:integer('attempts').notNull().default(0),nextRetryAt:text('next_retry_at'),
 lastError:text('last_error'),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull()
},t=>[index('idx_langfuse_owner_job_state').on(t.ownerId,t.jobId,t.state),index('idx_langfuse_owner_retry').on(t.ownerId,t.state,t.nextRetryAt)]);
