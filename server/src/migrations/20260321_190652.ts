import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "ingredients_discoveries" ADD COLUMN "schedule_limit" numeric DEFAULT 0;
  ALTER TABLE "ingredients_discoveries" ADD COLUMN "schedule_count" numeric DEFAULT 0;
  ALTER TABLE "ingredient_crawls" ADD COLUMN "schedule_limit" numeric DEFAULT 0;
  ALTER TABLE "ingredient_crawls" ADD COLUMN "schedule_count" numeric DEFAULT 0;
  ALTER TABLE "product_discoveries" ADD COLUMN "schedule_limit" numeric DEFAULT 0;
  ALTER TABLE "product_discoveries" ADD COLUMN "schedule_count" numeric DEFAULT 0;
  ALTER TABLE "product_searches" ADD COLUMN "schedule_limit" numeric DEFAULT 0;
  ALTER TABLE "product_searches" ADD COLUMN "schedule_count" numeric DEFAULT 0;
  ALTER TABLE "product_crawls" ADD COLUMN "schedule_limit" numeric DEFAULT 0;
  ALTER TABLE "product_crawls" ADD COLUMN "schedule_count" numeric DEFAULT 0;
  ALTER TABLE "product_aggregations" ADD COLUMN "schedule_limit" numeric DEFAULT 0;
  ALTER TABLE "product_aggregations" ADD COLUMN "schedule_count" numeric DEFAULT 0;
  ALTER TABLE "video_discoveries" ADD COLUMN "schedule_limit" numeric DEFAULT 0;
  ALTER TABLE "video_discoveries" ADD COLUMN "schedule_count" numeric DEFAULT 0;
  ALTER TABLE "video_crawls" ADD COLUMN "schedule_limit" numeric DEFAULT 0;
  ALTER TABLE "video_crawls" ADD COLUMN "schedule_count" numeric DEFAULT 0;
  ALTER TABLE "video_processings" ADD COLUMN "schedule_limit" numeric DEFAULT 0;
  ALTER TABLE "video_processings" ADD COLUMN "schedule_count" numeric DEFAULT 0;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "ingredients_discoveries" DROP COLUMN "schedule_limit";
  ALTER TABLE "ingredients_discoveries" DROP COLUMN "schedule_count";
  ALTER TABLE "ingredient_crawls" DROP COLUMN "schedule_limit";
  ALTER TABLE "ingredient_crawls" DROP COLUMN "schedule_count";
  ALTER TABLE "product_discoveries" DROP COLUMN "schedule_limit";
  ALTER TABLE "product_discoveries" DROP COLUMN "schedule_count";
  ALTER TABLE "product_searches" DROP COLUMN "schedule_limit";
  ALTER TABLE "product_searches" DROP COLUMN "schedule_count";
  ALTER TABLE "product_crawls" DROP COLUMN "schedule_limit";
  ALTER TABLE "product_crawls" DROP COLUMN "schedule_count";
  ALTER TABLE "product_aggregations" DROP COLUMN "schedule_limit";
  ALTER TABLE "product_aggregations" DROP COLUMN "schedule_count";
  ALTER TABLE "video_discoveries" DROP COLUMN "schedule_limit";
  ALTER TABLE "video_discoveries" DROP COLUMN "schedule_count";
  ALTER TABLE "video_crawls" DROP COLUMN "schedule_limit";
  ALTER TABLE "video_crawls" DROP COLUMN "schedule_count";
  ALTER TABLE "video_processings" DROP COLUMN "schedule_limit";
  ALTER TABLE "video_processings" DROP COLUMN "schedule_count";`)
}
