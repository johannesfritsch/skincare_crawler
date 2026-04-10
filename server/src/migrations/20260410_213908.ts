import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_bot_checks_status" AS ENUM('pending', 'scheduled', 'in_progress', 'completed', 'failed');
  ALTER TYPE "public"."enum_workers_capabilities" ADD VALUE 'bot-check' BEFORE 'event-purge';
  CREATE TABLE "bot_checks" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"status" "enum_bot_checks_status" DEFAULT 'pending',
  	"retry_count" numeric DEFAULT 0,
  	"max_retries" numeric DEFAULT 3,
  	"schedule" varchar,
  	"schedule_limit" numeric DEFAULT 0,
  	"schedule_count" numeric DEFAULT 0,
  	"scheduled_for" timestamp(3) with time zone,
  	"url" varchar DEFAULT 'https://bot-detector.rebrowser.net/' NOT NULL,
  	"claimed_at" timestamp(3) with time zone,
  	"claimed_by_id" integer,
  	"passed" numeric DEFAULT 0,
  	"failed" numeric DEFAULT 0,
  	"total" numeric DEFAULT 0,
  	"started_at" timestamp(3) with time zone,
  	"completed_at" timestamp(3) with time zone,
  	"screenshot_id" integer,
  	"result_json" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "events_rels" ADD COLUMN "bot_checks_id" integer;
  ALTER TABLE "debug_screenshots_rels" ADD COLUMN "bot_checks_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "bot_checks_id" integer;
  ALTER TABLE "bot_checks" ADD CONSTRAINT "bot_checks_claimed_by_id_workers_id_fk" FOREIGN KEY ("claimed_by_id") REFERENCES "public"."workers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "bot_checks" ADD CONSTRAINT "bot_checks_screenshot_id_debug_screenshots_id_fk" FOREIGN KEY ("screenshot_id") REFERENCES "public"."debug_screenshots"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "bot_checks_status_idx" ON "bot_checks" USING btree ("status");
  CREATE INDEX "bot_checks_claimed_by_idx" ON "bot_checks" USING btree ("claimed_by_id");
  CREATE INDEX "bot_checks_screenshot_idx" ON "bot_checks" USING btree ("screenshot_id");
  CREATE INDEX "bot_checks_updated_at_idx" ON "bot_checks" USING btree ("updated_at");
  CREATE INDEX "bot_checks_created_at_idx" ON "bot_checks" USING btree ("created_at");
  ALTER TABLE "events_rels" ADD CONSTRAINT "events_rels_bot_checks_fk" FOREIGN KEY ("bot_checks_id") REFERENCES "public"."bot_checks"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "debug_screenshots_rels" ADD CONSTRAINT "debug_screenshots_rels_bot_checks_fk" FOREIGN KEY ("bot_checks_id") REFERENCES "public"."bot_checks"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_bot_checks_fk" FOREIGN KEY ("bot_checks_id") REFERENCES "public"."bot_checks"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "events_rels_bot_checks_id_idx" ON "events_rels" USING btree ("bot_checks_id");
  CREATE INDEX "debug_screenshots_rels_bot_checks_id_idx" ON "debug_screenshots_rels" USING btree ("bot_checks_id");
  CREATE INDEX "payload_locked_documents_rels_bot_checks_id_idx" ON "payload_locked_documents_rels" USING btree ("bot_checks_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "bot_checks" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "bot_checks" CASCADE;
  ALTER TABLE "events_rels" DROP CONSTRAINT "events_rels_bot_checks_fk";
  
  ALTER TABLE "debug_screenshots_rels" DROP CONSTRAINT "debug_screenshots_rels_bot_checks_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_bot_checks_fk";
  
  ALTER TABLE "workers_capabilities" ALTER COLUMN "value" SET DATA TYPE text;
  DROP TYPE "public"."enum_workers_capabilities";
  CREATE TYPE "public"."enum_workers_capabilities" AS ENUM('product-crawl', 'product-discovery', 'product-search', 'ingredients-discovery', 'video-discovery', 'video-crawl', 'video-processing', 'product-aggregation', 'ingredient-crawl', 'event-purge');
  ALTER TABLE "workers_capabilities" ALTER COLUMN "value" SET DATA TYPE "public"."enum_workers_capabilities" USING "value"::"public"."enum_workers_capabilities";
  DROP INDEX "events_rels_bot_checks_id_idx";
  DROP INDEX "debug_screenshots_rels_bot_checks_id_idx";
  DROP INDEX "payload_locked_documents_rels_bot_checks_id_idx";
  ALTER TABLE "events_rels" DROP COLUMN "bot_checks_id";
  ALTER TABLE "debug_screenshots_rels" DROP COLUMN "bot_checks_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "bot_checks_id";
  DROP TYPE "public"."enum_bot_checks_status";`)
}
