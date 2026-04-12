import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_test_suites_searches_sources" AS ENUM('dm', 'rossmann', 'mueller', 'purish', 'douglas', 'shopapotheke');
  CREATE TYPE "public"."enum_test_suite_runs_status" AS ENUM('pending', 'running', 'passed', 'failed');
  CREATE TYPE "public"."enum_test_suite_runs_current_phase" AS ENUM('pending', 'searches', 'discoveries', 'crawls', 'aggregations', 'validating', 'done');
  CREATE TABLE "test_suites_searches_sources" (
  	"order" integer NOT NULL,
  	"parent_id" varchar NOT NULL,
  	"value" "enum_test_suites_searches_sources",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  CREATE TABLE "test_suites_searches" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"query" varchar NOT NULL,
  	"max_results" numeric DEFAULT 50,
  	"check_schema" jsonb
  );
  
  CREATE TABLE "test_suites_discoveries" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"source_url" varchar NOT NULL,
  	"check_schema" jsonb
  );
  
  CREATE TABLE "test_suites_crawls" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"urls" varchar NOT NULL,
  	"crawl_variants" boolean DEFAULT true,
  	"check_schema" jsonb
  );
  
  CREATE TABLE "test_suites_aggregations" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"gtins" varchar NOT NULL,
  	"check_schema" jsonb
  );
  
  CREATE TABLE "test_suites" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"description" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "test_suite_runs" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"test_suite_id" integer NOT NULL,
  	"status" "enum_test_suite_runs_status" DEFAULT 'pending' NOT NULL,
  	"current_phase" "enum_test_suite_runs_current_phase" DEFAULT 'pending',
  	"phases" jsonb,
  	"failure_reason" varchar,
  	"started_at" timestamp(3) with time zone,
  	"completed_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "product_discoveries" ADD COLUMN "test_suite_run_id" integer;
  ALTER TABLE "product_searches" ADD COLUMN "test_suite_run_id" integer;
  ALTER TABLE "product_crawls" ADD COLUMN "test_suite_run_id" integer;
  ALTER TABLE "product_aggregations" ADD COLUMN "test_suite_run_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "test_suites_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "test_suite_runs_id" integer;
  ALTER TABLE "test_suites_searches_sources" ADD CONSTRAINT "test_suites_searches_sources_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."test_suites_searches"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "test_suites_searches" ADD CONSTRAINT "test_suites_searches_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."test_suites"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "test_suites_discoveries" ADD CONSTRAINT "test_suites_discoveries_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."test_suites"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "test_suites_crawls" ADD CONSTRAINT "test_suites_crawls_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."test_suites"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "test_suites_aggregations" ADD CONSTRAINT "test_suites_aggregations_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."test_suites"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "test_suite_runs" ADD CONSTRAINT "test_suite_runs_test_suite_id_test_suites_id_fk" FOREIGN KEY ("test_suite_id") REFERENCES "public"."test_suites"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "test_suites_searches_sources_order_idx" ON "test_suites_searches_sources" USING btree ("order");
  CREATE INDEX "test_suites_searches_sources_parent_idx" ON "test_suites_searches_sources" USING btree ("parent_id");
  CREATE INDEX "test_suites_searches_order_idx" ON "test_suites_searches" USING btree ("_order");
  CREATE INDEX "test_suites_searches_parent_id_idx" ON "test_suites_searches" USING btree ("_parent_id");
  CREATE INDEX "test_suites_discoveries_order_idx" ON "test_suites_discoveries" USING btree ("_order");
  CREATE INDEX "test_suites_discoveries_parent_id_idx" ON "test_suites_discoveries" USING btree ("_parent_id");
  CREATE INDEX "test_suites_crawls_order_idx" ON "test_suites_crawls" USING btree ("_order");
  CREATE INDEX "test_suites_crawls_parent_id_idx" ON "test_suites_crawls" USING btree ("_parent_id");
  CREATE INDEX "test_suites_aggregations_order_idx" ON "test_suites_aggregations" USING btree ("_order");
  CREATE INDEX "test_suites_aggregations_parent_id_idx" ON "test_suites_aggregations" USING btree ("_parent_id");
  CREATE INDEX "test_suites_updated_at_idx" ON "test_suites" USING btree ("updated_at");
  CREATE INDEX "test_suites_created_at_idx" ON "test_suites" USING btree ("created_at");
  CREATE INDEX "test_suite_runs_test_suite_idx" ON "test_suite_runs" USING btree ("test_suite_id");
  CREATE INDEX "test_suite_runs_updated_at_idx" ON "test_suite_runs" USING btree ("updated_at");
  CREATE INDEX "test_suite_runs_created_at_idx" ON "test_suite_runs" USING btree ("created_at");
  ALTER TABLE "product_discoveries" ADD CONSTRAINT "product_discoveries_test_suite_run_id_test_suite_runs_id_fk" FOREIGN KEY ("test_suite_run_id") REFERENCES "public"."test_suite_runs"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "product_searches" ADD CONSTRAINT "product_searches_test_suite_run_id_test_suite_runs_id_fk" FOREIGN KEY ("test_suite_run_id") REFERENCES "public"."test_suite_runs"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "product_crawls" ADD CONSTRAINT "product_crawls_test_suite_run_id_test_suite_runs_id_fk" FOREIGN KEY ("test_suite_run_id") REFERENCES "public"."test_suite_runs"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "product_aggregations" ADD CONSTRAINT "product_aggregations_test_suite_run_id_test_suite_runs_id_fk" FOREIGN KEY ("test_suite_run_id") REFERENCES "public"."test_suite_runs"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_test_suites_fk" FOREIGN KEY ("test_suites_id") REFERENCES "public"."test_suites"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_test_suite_runs_fk" FOREIGN KEY ("test_suite_runs_id") REFERENCES "public"."test_suite_runs"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "product_discoveries_test_suite_run_idx" ON "product_discoveries" USING btree ("test_suite_run_id");
  CREATE INDEX "product_searches_test_suite_run_idx" ON "product_searches" USING btree ("test_suite_run_id");
  CREATE INDEX "product_crawls_test_suite_run_idx" ON "product_crawls" USING btree ("test_suite_run_id");
  CREATE INDEX "product_aggregations_test_suite_run_idx" ON "product_aggregations" USING btree ("test_suite_run_id");
  CREATE INDEX "payload_locked_documents_rels_test_suites_id_idx" ON "payload_locked_documents_rels" USING btree ("test_suites_id");
  CREATE INDEX "payload_locked_documents_rels_test_suite_runs_id_idx" ON "payload_locked_documents_rels" USING btree ("test_suite_runs_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "test_suites_searches_sources" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "test_suites_searches" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "test_suites_discoveries" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "test_suites_crawls" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "test_suites_aggregations" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "test_suites" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "test_suite_runs" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "test_suites_searches_sources" CASCADE;
  DROP TABLE "test_suites_searches" CASCADE;
  DROP TABLE "test_suites_discoveries" CASCADE;
  DROP TABLE "test_suites_crawls" CASCADE;
  DROP TABLE "test_suites_aggregations" CASCADE;
  DROP TABLE "test_suites" CASCADE;
  DROP TABLE "test_suite_runs" CASCADE;
  ALTER TABLE "product_discoveries" DROP CONSTRAINT "product_discoveries_test_suite_run_id_test_suite_runs_id_fk";
  
  ALTER TABLE "product_searches" DROP CONSTRAINT "product_searches_test_suite_run_id_test_suite_runs_id_fk";
  
  ALTER TABLE "product_crawls" DROP CONSTRAINT "product_crawls_test_suite_run_id_test_suite_runs_id_fk";
  
  ALTER TABLE "product_aggregations" DROP CONSTRAINT "product_aggregations_test_suite_run_id_test_suite_runs_id_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_test_suites_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_test_suite_runs_fk";
  
  DROP INDEX "product_discoveries_test_suite_run_idx";
  DROP INDEX "product_searches_test_suite_run_idx";
  DROP INDEX "product_crawls_test_suite_run_idx";
  DROP INDEX "product_aggregations_test_suite_run_idx";
  DROP INDEX "payload_locked_documents_rels_test_suites_id_idx";
  DROP INDEX "payload_locked_documents_rels_test_suite_runs_id_idx";
  ALTER TABLE "product_discoveries" DROP COLUMN "test_suite_run_id";
  ALTER TABLE "product_searches" DROP COLUMN "test_suite_run_id";
  ALTER TABLE "product_crawls" DROP COLUMN "test_suite_run_id";
  ALTER TABLE "product_aggregations" DROP COLUMN "test_suite_run_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "test_suites_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "test_suite_runs_id";
  DROP TYPE "public"."enum_test_suites_searches_sources";
  DROP TYPE "public"."enum_test_suite_runs_status";
  DROP TYPE "public"."enum_test_suite_runs_current_phase";`)
}
