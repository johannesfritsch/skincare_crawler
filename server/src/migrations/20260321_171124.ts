import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_ingredients_discoveries_status" ADD VALUE 'scheduled' BEFORE 'in_progress';
  ALTER TYPE "public"."enum_ingredient_crawls_status" ADD VALUE 'scheduled' BEFORE 'in_progress';
  ALTER TYPE "public"."enum_product_discoveries_status" ADD VALUE 'scheduled' BEFORE 'in_progress';
  ALTER TYPE "public"."enum_product_searches_status" ADD VALUE 'scheduled' BEFORE 'in_progress';
  ALTER TYPE "public"."enum_product_crawls_status" ADD VALUE 'scheduled' BEFORE 'in_progress';
  ALTER TYPE "public"."enum_product_aggregations_status" ADD VALUE 'scheduled' BEFORE 'in_progress';
  ALTER TYPE "public"."enum_video_discoveries_status" ADD VALUE 'scheduled' BEFORE 'in_progress';
  ALTER TYPE "public"."enum_video_crawls_status" ADD VALUE 'scheduled' BEFORE 'in_progress';
  ALTER TYPE "public"."enum_video_processings_status" ADD VALUE 'scheduled' BEFORE 'in_progress';
  ALTER TABLE "ingredients_discoveries" ADD COLUMN "schedule" varchar;
  ALTER TABLE "ingredients_discoveries" ADD COLUMN "scheduled_for" timestamp(3) with time zone;
  ALTER TABLE "ingredient_crawls" ADD COLUMN "schedule" varchar;
  ALTER TABLE "ingredient_crawls" ADD COLUMN "scheduled_for" timestamp(3) with time zone;
  ALTER TABLE "product_discoveries" ADD COLUMN "schedule" varchar;
  ALTER TABLE "product_discoveries" ADD COLUMN "scheduled_for" timestamp(3) with time zone;
  ALTER TABLE "product_searches" ADD COLUMN "schedule" varchar;
  ALTER TABLE "product_searches" ADD COLUMN "scheduled_for" timestamp(3) with time zone;
  ALTER TABLE "product_crawls" ADD COLUMN "schedule" varchar;
  ALTER TABLE "product_crawls" ADD COLUMN "scheduled_for" timestamp(3) with time zone;
  ALTER TABLE "product_aggregations" ADD COLUMN "schedule" varchar;
  ALTER TABLE "product_aggregations" ADD COLUMN "scheduled_for" timestamp(3) with time zone;
  ALTER TABLE "video_discoveries" ADD COLUMN "schedule" varchar;
  ALTER TABLE "video_discoveries" ADD COLUMN "scheduled_for" timestamp(3) with time zone;
  ALTER TABLE "video_crawls" ADD COLUMN "schedule" varchar;
  ALTER TABLE "video_crawls" ADD COLUMN "scheduled_for" timestamp(3) with time zone;
  ALTER TABLE "video_processings" ADD COLUMN "schedule" varchar;
  ALTER TABLE "video_processings" ADD COLUMN "scheduled_for" timestamp(3) with time zone;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "ingredients_discoveries" ALTER COLUMN "status" SET DATA TYPE text;
  ALTER TABLE "ingredients_discoveries" ALTER COLUMN "status" SET DEFAULT 'pending'::text;
  DROP TYPE "public"."enum_ingredients_discoveries_status";
  CREATE TYPE "public"."enum_ingredients_discoveries_status" AS ENUM('pending', 'in_progress', 'completed', 'failed');
  ALTER TABLE "ingredients_discoveries" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."enum_ingredients_discoveries_status";
  ALTER TABLE "ingredients_discoveries" ALTER COLUMN "status" SET DATA TYPE "public"."enum_ingredients_discoveries_status" USING "status"::"public"."enum_ingredients_discoveries_status";
  ALTER TABLE "ingredient_crawls" ALTER COLUMN "status" SET DATA TYPE text;
  ALTER TABLE "ingredient_crawls" ALTER COLUMN "status" SET DEFAULT 'pending'::text;
  DROP TYPE "public"."enum_ingredient_crawls_status";
  CREATE TYPE "public"."enum_ingredient_crawls_status" AS ENUM('pending', 'in_progress', 'completed', 'failed');
  ALTER TABLE "ingredient_crawls" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."enum_ingredient_crawls_status";
  ALTER TABLE "ingredient_crawls" ALTER COLUMN "status" SET DATA TYPE "public"."enum_ingredient_crawls_status" USING "status"::"public"."enum_ingredient_crawls_status";
  ALTER TABLE "product_discoveries" ALTER COLUMN "status" SET DATA TYPE text;
  ALTER TABLE "product_discoveries" ALTER COLUMN "status" SET DEFAULT 'pending'::text;
  DROP TYPE "public"."enum_product_discoveries_status";
  CREATE TYPE "public"."enum_product_discoveries_status" AS ENUM('pending', 'in_progress', 'completed', 'failed');
  ALTER TABLE "product_discoveries" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."enum_product_discoveries_status";
  ALTER TABLE "product_discoveries" ALTER COLUMN "status" SET DATA TYPE "public"."enum_product_discoveries_status" USING "status"::"public"."enum_product_discoveries_status";
  ALTER TABLE "product_searches" ALTER COLUMN "status" SET DATA TYPE text;
  ALTER TABLE "product_searches" ALTER COLUMN "status" SET DEFAULT 'pending'::text;
  DROP TYPE "public"."enum_product_searches_status";
  CREATE TYPE "public"."enum_product_searches_status" AS ENUM('pending', 'in_progress', 'completed', 'failed');
  ALTER TABLE "product_searches" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."enum_product_searches_status";
  ALTER TABLE "product_searches" ALTER COLUMN "status" SET DATA TYPE "public"."enum_product_searches_status" USING "status"::"public"."enum_product_searches_status";
  ALTER TABLE "product_crawls" ALTER COLUMN "status" SET DATA TYPE text;
  ALTER TABLE "product_crawls" ALTER COLUMN "status" SET DEFAULT 'pending'::text;
  DROP TYPE "public"."enum_product_crawls_status";
  CREATE TYPE "public"."enum_product_crawls_status" AS ENUM('pending', 'in_progress', 'completed', 'failed');
  ALTER TABLE "product_crawls" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."enum_product_crawls_status";
  ALTER TABLE "product_crawls" ALTER COLUMN "status" SET DATA TYPE "public"."enum_product_crawls_status" USING "status"::"public"."enum_product_crawls_status";
  ALTER TABLE "product_aggregations" ALTER COLUMN "status" SET DATA TYPE text;
  ALTER TABLE "product_aggregations" ALTER COLUMN "status" SET DEFAULT 'pending'::text;
  DROP TYPE "public"."enum_product_aggregations_status";
  CREATE TYPE "public"."enum_product_aggregations_status" AS ENUM('pending', 'in_progress', 'completed', 'failed');
  ALTER TABLE "product_aggregations" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."enum_product_aggregations_status";
  ALTER TABLE "product_aggregations" ALTER COLUMN "status" SET DATA TYPE "public"."enum_product_aggregations_status" USING "status"::"public"."enum_product_aggregations_status";
  ALTER TABLE "video_discoveries" ALTER COLUMN "status" SET DATA TYPE text;
  ALTER TABLE "video_discoveries" ALTER COLUMN "status" SET DEFAULT 'pending'::text;
  DROP TYPE "public"."enum_video_discoveries_status";
  CREATE TYPE "public"."enum_video_discoveries_status" AS ENUM('pending', 'in_progress', 'completed', 'failed');
  ALTER TABLE "video_discoveries" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."enum_video_discoveries_status";
  ALTER TABLE "video_discoveries" ALTER COLUMN "status" SET DATA TYPE "public"."enum_video_discoveries_status" USING "status"::"public"."enum_video_discoveries_status";
  ALTER TABLE "video_crawls" ALTER COLUMN "status" SET DATA TYPE text;
  ALTER TABLE "video_crawls" ALTER COLUMN "status" SET DEFAULT 'pending'::text;
  DROP TYPE "public"."enum_video_crawls_status";
  CREATE TYPE "public"."enum_video_crawls_status" AS ENUM('pending', 'in_progress', 'completed', 'failed');
  ALTER TABLE "video_crawls" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."enum_video_crawls_status";
  ALTER TABLE "video_crawls" ALTER COLUMN "status" SET DATA TYPE "public"."enum_video_crawls_status" USING "status"::"public"."enum_video_crawls_status";
  ALTER TABLE "video_processings" ALTER COLUMN "status" SET DATA TYPE text;
  ALTER TABLE "video_processings" ALTER COLUMN "status" SET DEFAULT 'pending'::text;
  DROP TYPE "public"."enum_video_processings_status";
  CREATE TYPE "public"."enum_video_processings_status" AS ENUM('pending', 'in_progress', 'completed', 'failed');
  ALTER TABLE "video_processings" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."enum_video_processings_status";
  ALTER TABLE "video_processings" ALTER COLUMN "status" SET DATA TYPE "public"."enum_video_processings_status" USING "status"::"public"."enum_video_processings_status";
  ALTER TABLE "ingredients_discoveries" DROP COLUMN "schedule";
  ALTER TABLE "ingredients_discoveries" DROP COLUMN "scheduled_for";
  ALTER TABLE "ingredient_crawls" DROP COLUMN "schedule";
  ALTER TABLE "ingredient_crawls" DROP COLUMN "scheduled_for";
  ALTER TABLE "product_discoveries" DROP COLUMN "schedule";
  ALTER TABLE "product_discoveries" DROP COLUMN "scheduled_for";
  ALTER TABLE "product_searches" DROP COLUMN "schedule";
  ALTER TABLE "product_searches" DROP COLUMN "scheduled_for";
  ALTER TABLE "product_crawls" DROP COLUMN "schedule";
  ALTER TABLE "product_crawls" DROP COLUMN "scheduled_for";
  ALTER TABLE "product_aggregations" DROP COLUMN "schedule";
  ALTER TABLE "product_aggregations" DROP COLUMN "scheduled_for";
  ALTER TABLE "video_discoveries" DROP COLUMN "schedule";
  ALTER TABLE "video_discoveries" DROP COLUMN "scheduled_for";
  ALTER TABLE "video_crawls" DROP COLUMN "schedule";
  ALTER TABLE "video_crawls" DROP COLUMN "scheduled_for";
  ALTER TABLE "video_processings" DROP COLUMN "schedule";
  ALTER TABLE "video_processings" DROP COLUMN "scheduled_for";`)
}
