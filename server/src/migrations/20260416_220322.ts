import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_test_suite_runs_current_phase" ADD VALUE 'videoDiscoveries' BEFORE 'done';
  ALTER TYPE "public"."enum_test_suite_runs_current_phase" ADD VALUE 'videoCrawls' BEFORE 'done';
  ALTER TYPE "public"."enum_test_suite_runs_current_phase" ADD VALUE 'videoProcessings' BEFORE 'done';`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "test_suite_runs" ALTER COLUMN "current_phase" SET DATA TYPE text;
  ALTER TABLE "test_suite_runs" ALTER COLUMN "current_phase" SET DEFAULT 'pending'::text;
  DROP TYPE "public"."enum_test_suite_runs_current_phase";
  CREATE TYPE "public"."enum_test_suite_runs_current_phase" AS ENUM('pending', 'searches', 'discoveries', 'crawls', 'aggregations', 'done');
  ALTER TABLE "test_suite_runs" ALTER COLUMN "current_phase" SET DEFAULT 'pending'::"public"."enum_test_suite_runs_current_phase";
  ALTER TABLE "test_suite_runs" ALTER COLUMN "current_phase" SET DATA TYPE "public"."enum_test_suite_runs_current_phase" USING "current_phase"::"public"."enum_test_suite_runs_current_phase";`)
}
