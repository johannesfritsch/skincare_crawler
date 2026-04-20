import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_workers_capabilities" ADD VALUE 'gallery-discovery' BEFORE 'bot-check';
  ALTER TYPE "public"."enum_workers_capabilities" ADD VALUE 'gallery-crawl' BEFORE 'bot-check';
  ALTER TYPE "public"."enum_workers_capabilities" ADD VALUE 'gallery-processing' BEFORE 'bot-check';`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "workers_capabilities" ALTER COLUMN "value" SET DATA TYPE text;
  DROP TYPE "public"."enum_workers_capabilities";
  CREATE TYPE "public"."enum_workers_capabilities" AS ENUM('product-crawl', 'product-discovery', 'product-search', 'ingredients-discovery', 'video-discovery', 'video-crawl', 'video-processing', 'product-aggregation', 'ingredient-crawl', 'bot-check', 'test-suite-run', 'event-purge');
  ALTER TABLE "workers_capabilities" ALTER COLUMN "value" SET DATA TYPE "public"."enum_workers_capabilities" USING "value"::"public"."enum_workers_capabilities";`)
}
