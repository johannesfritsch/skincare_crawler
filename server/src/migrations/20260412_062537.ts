import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_workers_capabilities" ADD VALUE 'test-suite-run' BEFORE 'event-purge';
  ALTER TABLE "product_discoveries" DROP CONSTRAINT IF EXISTS "product_discoveries_test_suite_run_id_test_suite_runs_id_fk";

  ALTER TABLE "product_searches" DROP CONSTRAINT IF EXISTS "product_searches_test_suite_run_id_test_suite_runs_id_fk";

  ALTER TABLE "product_crawls" DROP CONSTRAINT IF EXISTS "product_crawls_test_suite_run_id_test_suite_runs_id_fk";

  ALTER TABLE "product_aggregations" DROP CONSTRAINT IF EXISTS "product_aggregations_test_suite_run_id_test_suite_runs_id_fk";

  -- Delete existing test suite runs (they have old enum values incompatible with new schema)
  DELETE FROM "test_suite_runs";

  ALTER TABLE "test_suite_runs" ALTER COLUMN "status" SET DATA TYPE text;
  ALTER TABLE "test_suite_runs" ALTER COLUMN "status" SET DEFAULT 'pending'::text;
  DROP TYPE IF EXISTS "public"."enum_test_suite_runs_status";
  CREATE TYPE "public"."enum_test_suite_runs_status" AS ENUM('pending', 'scheduled', 'in_progress', 'completed', 'failed');
  ALTER TABLE "test_suite_runs" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."enum_test_suite_runs_status";
  ALTER TABLE "test_suite_runs" ALTER COLUMN "status" SET DATA TYPE "public"."enum_test_suite_runs_status" USING "status"::"public"."enum_test_suite_runs_status";
  ALTER TABLE "test_suite_runs" ALTER COLUMN "current_phase" SET DATA TYPE text;
  ALTER TABLE "test_suite_runs" ALTER COLUMN "current_phase" SET DEFAULT 'pending'::text;
  DROP TYPE "public"."enum_test_suite_runs_current_phase";
  CREATE TYPE "public"."enum_test_suite_runs_current_phase" AS ENUM('pending', 'searches', 'discoveries', 'crawls', 'aggregations', 'done');
  ALTER TABLE "test_suite_runs" ALTER COLUMN "current_phase" SET DEFAULT 'pending'::"public"."enum_test_suite_runs_current_phase";
  ALTER TABLE "test_suite_runs" ALTER COLUMN "current_phase" SET DATA TYPE "public"."enum_test_suite_runs_current_phase" USING "current_phase"::"public"."enum_test_suite_runs_current_phase";
  DROP INDEX IF EXISTS "product_discoveries_test_suite_run_idx";
  DROP INDEX IF EXISTS "product_searches_test_suite_run_idx";
  DROP INDEX IF EXISTS "product_crawls_test_suite_run_idx";
  DROP INDEX IF EXISTS "product_aggregations_test_suite_run_idx";
  ALTER TABLE "test_suite_runs" ALTER COLUMN "status" DROP NOT NULL;
  ALTER TABLE "test_suite_runs" ADD COLUMN "retry_count" numeric DEFAULT 0;
  ALTER TABLE "test_suite_runs" ADD COLUMN "max_retries" numeric DEFAULT 3;
  ALTER TABLE "test_suite_runs" ADD COLUMN "schedule" varchar;
  ALTER TABLE "test_suite_runs" ADD COLUMN "schedule_limit" numeric DEFAULT 0;
  ALTER TABLE "test_suite_runs" ADD COLUMN "schedule_count" numeric DEFAULT 0;
  ALTER TABLE "test_suite_runs" ADD COLUMN "scheduled_for" timestamp(3) with time zone;
  ALTER TABLE "test_suite_runs" ADD COLUMN "claimed_at" timestamp(3) with time zone;
  ALTER TABLE "test_suite_runs" ADD COLUMN "claimed_by_id" integer;
  ALTER TABLE "test_suite_runs" ADD COLUMN "passed" numeric DEFAULT 0;
  ALTER TABLE "test_suite_runs" ADD COLUMN "failed" numeric DEFAULT 0;
  ALTER TABLE "events_rels" ADD COLUMN "test_suite_runs_id" integer;
  ALTER TABLE "test_suite_runs" ADD CONSTRAINT "test_suite_runs_claimed_by_id_workers_id_fk" FOREIGN KEY ("claimed_by_id") REFERENCES "public"."workers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "events_rels" ADD CONSTRAINT "events_rels_test_suite_runs_fk" FOREIGN KEY ("test_suite_runs_id") REFERENCES "public"."test_suite_runs"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "test_suite_runs_status_idx" ON "test_suite_runs" USING btree ("status");
  CREATE INDEX "test_suite_runs_claimed_by_idx" ON "test_suite_runs" USING btree ("claimed_by_id");
  CREATE INDEX "events_rels_test_suite_runs_id_idx" ON "events_rels" USING btree ("test_suite_runs_id");
  ALTER TABLE "product_discoveries" DROP COLUMN "test_suite_run_id";
  ALTER TABLE "product_searches" DROP COLUMN "test_suite_run_id";
  ALTER TABLE "product_crawls" DROP COLUMN "test_suite_run_id";
  ALTER TABLE "product_aggregations" DROP COLUMN "test_suite_run_id";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_test_suite_runs_current_phase" ADD VALUE 'validating' BEFORE 'done';
  ALTER TABLE "test_suite_runs" DROP CONSTRAINT "test_suite_runs_claimed_by_id_workers_id_fk";
  
  ALTER TABLE "events_rels" DROP CONSTRAINT "events_rels_test_suite_runs_fk";
  
  ALTER TABLE "test_suite_runs" ALTER COLUMN "status" SET DATA TYPE text;
  ALTER TABLE "test_suite_runs" ALTER COLUMN "status" SET DEFAULT 'pending'::text;
  DROP TYPE "public"."enum_test_suite_runs_status";
  CREATE TYPE "public"."enum_test_suite_runs_status" AS ENUM('pending', 'running', 'passed', 'failed');
  ALTER TABLE "test_suite_runs" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."enum_test_suite_runs_status";
  ALTER TABLE "test_suite_runs" ALTER COLUMN "status" SET DATA TYPE "public"."enum_test_suite_runs_status" USING "status"::"public"."enum_test_suite_runs_status";
  ALTER TABLE "workers_capabilities" ALTER COLUMN "value" SET DATA TYPE text;
  DROP TYPE "public"."enum_workers_capabilities";
  CREATE TYPE "public"."enum_workers_capabilities" AS ENUM('product-crawl', 'product-discovery', 'product-search', 'ingredients-discovery', 'video-discovery', 'video-crawl', 'video-processing', 'product-aggregation', 'ingredient-crawl', 'bot-check', 'event-purge');
  ALTER TABLE "workers_capabilities" ALTER COLUMN "value" SET DATA TYPE "public"."enum_workers_capabilities" USING "value"::"public"."enum_workers_capabilities";
  DROP INDEX "test_suite_runs_status_idx";
  DROP INDEX "test_suite_runs_claimed_by_idx";
  DROP INDEX "events_rels_test_suite_runs_id_idx";
  ALTER TABLE "test_suite_runs" ALTER COLUMN "status" SET NOT NULL;
  ALTER TABLE "product_discoveries" ADD COLUMN "test_suite_run_id" integer;
  ALTER TABLE "product_searches" ADD COLUMN "test_suite_run_id" integer;
  ALTER TABLE "product_crawls" ADD COLUMN "test_suite_run_id" integer;
  ALTER TABLE "product_aggregations" ADD COLUMN "test_suite_run_id" integer;
  ALTER TABLE "product_discoveries" ADD CONSTRAINT "product_discoveries_test_suite_run_id_test_suite_runs_id_fk" FOREIGN KEY ("test_suite_run_id") REFERENCES "public"."test_suite_runs"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "product_searches" ADD CONSTRAINT "product_searches_test_suite_run_id_test_suite_runs_id_fk" FOREIGN KEY ("test_suite_run_id") REFERENCES "public"."test_suite_runs"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "product_crawls" ADD CONSTRAINT "product_crawls_test_suite_run_id_test_suite_runs_id_fk" FOREIGN KEY ("test_suite_run_id") REFERENCES "public"."test_suite_runs"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "product_aggregations" ADD CONSTRAINT "product_aggregations_test_suite_run_id_test_suite_runs_id_fk" FOREIGN KEY ("test_suite_run_id") REFERENCES "public"."test_suite_runs"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "product_discoveries_test_suite_run_idx" ON "product_discoveries" USING btree ("test_suite_run_id");
  CREATE INDEX "product_searches_test_suite_run_idx" ON "product_searches" USING btree ("test_suite_run_id");
  CREATE INDEX "product_crawls_test_suite_run_idx" ON "product_crawls" USING btree ("test_suite_run_id");
  CREATE INDEX "product_aggregations_test_suite_run_idx" ON "product_aggregations" USING btree ("test_suite_run_id");
  ALTER TABLE "test_suite_runs" DROP COLUMN "retry_count";
  ALTER TABLE "test_suite_runs" DROP COLUMN "max_retries";
  ALTER TABLE "test_suite_runs" DROP COLUMN "schedule";
  ALTER TABLE "test_suite_runs" DROP COLUMN "schedule_limit";
  ALTER TABLE "test_suite_runs" DROP COLUMN "schedule_count";
  ALTER TABLE "test_suite_runs" DROP COLUMN "scheduled_for";
  ALTER TABLE "test_suite_runs" DROP COLUMN "claimed_at";
  ALTER TABLE "test_suite_runs" DROP COLUMN "claimed_by_id";
  ALTER TABLE "test_suite_runs" DROP COLUMN "passed";
  ALTER TABLE "test_suite_runs" DROP COLUMN "failed";
  ALTER TABLE "events_rels" DROP COLUMN "test_suite_runs_id";`)
}
