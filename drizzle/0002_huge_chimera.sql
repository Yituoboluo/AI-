CREATE TABLE `langfuse_exports` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`job_id` text NOT NULL,
	`item_type` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`payload_json` text NOT NULL,
	`occurred_at` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_retry_at` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_langfuse_owner_job_state` ON `langfuse_exports` (`owner_id`,`job_id`,`state`);--> statement-breakpoint
CREATE INDEX `idx_langfuse_owner_retry` ON `langfuse_exports` (`owner_id`,`state`,`next_retry_at`);--> statement-breakpoint
CREATE INDEX `idx_jobs_owner_task` ON `generation_jobs` (`owner_id`,`task_id`);