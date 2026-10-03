CREATE TABLE `workspace_events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`revision` integer NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_events_owner_created` ON `workspace_events` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `generation_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`source_revision` integer NOT NULL,
	`source_version` integer NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`status` text NOT NULL,
	`input_json` text NOT NULL,
	`result_json` text,
	`error_code` text,
	`error_message` text,
	`usage_json` text,
	`created_at` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	`feedback` text,
	`feedback_reason` text,
	`feedback_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_jobs_owner_created` ON `generation_jobs` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_jobs_owner_project` ON `generation_jobs` (`owner_id`,`project_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`draft_json` text NOT NULL,
	`image_key` text,
	`background_key` text,
	`thumbnail_key` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_projects_owner_updated` ON `projects` (`owner_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `daily_quota` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`day` text NOT NULL,
	`kind` text NOT NULL,
	`used` integer DEFAULT 0 NOT NULL
);
