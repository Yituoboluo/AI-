CREATE TABLE `asset_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`job_id` text NOT NULL,
	`task_id` text,
	`feedback` text NOT NULL,
	`reason_code` text NOT NULL,
	`note` text NOT NULL,
	`created_at` text NOT NULL,
	`request_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_feedback_owner_asset` ON `asset_feedback` (`owner_id`,`asset_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_feedback_owner_task` ON `asset_feedback` (`owner_id`,`task_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `creative_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`job_id` text NOT NULL,
	`task_id` text,
	`version` integer NOT NULL,
	`output_index` integer NOT NULL,
	`concept_id` text,
	`image_url` text NOT NULL,
	`title` text NOT NULL,
	`subtitle` text NOT NULL,
	`layout` text NOT NULL,
	`metadata_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_assets_owner_job_version` ON `creative_assets` (`owner_id`,`job_id`,`version`);--> statement-breakpoint
CREATE TABLE `quality_badcases` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`job_id` text NOT NULL,
	`asset_id` text,
	`kind` text NOT NULL,
	`stage` text NOT NULL,
	`code` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`evidence_json` text NOT NULL,
	`hypothesis` text DEFAULT '' NOT NULL,
	`fix` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`closed_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_badcases_owner_status` ON `quality_badcases` (`owner_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `quality_regressions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`badcase_id` text NOT NULL,
	`job_id` text NOT NULL,
	`asset_id` text,
	`outcome` text NOT NULL,
	`report_json` text NOT NULL,
	`request_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_regressions_owner_case` ON `quality_regressions` (`owner_id`,`badcase_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `quality_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`job_id` text NOT NULL,
	`asset_id` text,
	`kind` text NOT NULL,
	`rubric_version` text NOT NULL,
	`passed` integer,
	`score` integer,
	`report_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_reviews_owner_job` ON `quality_reviews` (`owner_id`,`job_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_reviews_owner_asset` ON `quality_reviews` (`owner_id`,`asset_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `telemetry_events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`project_id` text NOT NULL,
	`task_id` text,
	`job_id` text,
	`asset_id` text,
	`asset_version` integer,
	`input_revision` integer,
	`trace_id` text NOT NULL,
	`span_id` text,
	`parent_span_id` text,
	`name` text NOT NULL,
	`stage` text NOT NULL,
	`status` text NOT NULL,
	`duration_ms` integer,
	`source` text NOT NULL,
	`environment` text NOT NULL,
	`occurred_at` text NOT NULL,
	`received_at` text NOT NULL,
	`data_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_telemetry_owner_job` ON `telemetry_events` (`owner_id`,`job_id`,`received_at`);--> statement-breakpoint
CREATE INDEX `idx_telemetry_owner_project` ON `telemetry_events` (`owner_id`,`project_id`,`received_at`);--> statement-breakpoint
ALTER TABLE `generation_jobs` ADD `task_id` text;--> statement-breakpoint
ALTER TABLE `generation_jobs` ADD `parent_job_id` text;--> statement-breakpoint
ALTER TABLE `generation_jobs` ADD `attempt_no` integer;--> statement-breakpoint
ALTER TABLE `generation_jobs` ADD `input_fingerprint` text;--> statement-breakpoint
ALTER TABLE `generation_jobs` ADD `environment` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `generation_jobs` ADD `evaluation_json` text;--> statement-breakpoint
ALTER TABLE `generation_jobs` ADD `workflow_version` text;