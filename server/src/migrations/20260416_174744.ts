import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "ingredients_discoveries" DROP COLUMN IF EXISTS "current_term";
  ALTER TABLE "ingredients_discoveries" DROP COLUMN IF EXISTS "current_page";
  ALTER TABLE "ingredients_discoveries" DROP COLUMN IF EXISTS "total_pages_for_term";
  ALTER TABLE "ingredients_discoveries" DROP COLUMN IF EXISTS "term_queue";
  ALTER TABLE "ingredients_discoveries" DROP COLUMN IF EXISTS "pages_per_tick";
  ALTER TABLE "ingredient_crawls" DROP COLUMN IF EXISTS "items_per_tick";
  ALTER TABLE "product_discoveries" DROP COLUMN IF EXISTS "items_per_tick";
  ALTER TABLE "product_crawls" DROP COLUMN IF EXISTS "items_per_tick";
  ALTER TABLE "product_aggregations" DROP COLUMN IF EXISTS "items_per_tick";
  ALTER TABLE "video_discoveries" DROP COLUMN IF EXISTS "items_per_tick";
  ALTER TABLE "video_crawls" DROP COLUMN IF EXISTS "items_per_tick";
  ALTER TABLE "video_processings" DROP COLUMN IF EXISTS "items_per_tick";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "ingredients_discoveries" ADD COLUMN "pages_per_tick" numeric;
  ALTER TABLE "ingredients_discoveries" ADD COLUMN "current_term" varchar;
  ALTER TABLE "ingredients_discoveries" ADD COLUMN "current_page" numeric;
  ALTER TABLE "ingredients_discoveries" ADD COLUMN "total_pages_for_term" numeric;
  ALTER TABLE "ingredients_discoveries" ADD COLUMN "term_queue" jsonb;
  ALTER TABLE "ingredient_crawls" ADD COLUMN "items_per_tick" numeric DEFAULT 10;
  ALTER TABLE "product_discoveries" ADD COLUMN "items_per_tick" numeric;
  ALTER TABLE "product_crawls" ADD COLUMN "items_per_tick" numeric DEFAULT 10;
  ALTER TABLE "product_aggregations" ADD COLUMN "items_per_tick" numeric DEFAULT 10;
  ALTER TABLE "video_discoveries" ADD COLUMN "items_per_tick" numeric;
  ALTER TABLE "video_crawls" ADD COLUMN "items_per_tick" numeric DEFAULT 5;
  ALTER TABLE "video_processings" ADD COLUMN "items_per_tick" numeric DEFAULT 1;`)
}
