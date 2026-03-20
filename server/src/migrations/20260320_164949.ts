import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_video_scenes_detections_sources" ADD VALUE 'ocr';
  ALTER TYPE "public"."enum_video_scenes_detections_sources" ADD VALUE 'transcript';
  ALTER TYPE "public"."enum_video_mentions_sources" ADD VALUE 'ocr';
  ALTER TYPE "public"."enum_video_mentions_sources" ADD VALUE 'transcript';
  ALTER TABLE "video_processings" ALTER COLUMN "search_threshold" SET DEFAULT 0.8;
  ALTER TABLE "video_processings" ALTER COLUMN "search_limit" SET DEFAULT 3;
  ALTER TABLE "video_scenes_objects" ADD COLUMN "ocr_brand" varchar;
  ALTER TABLE "video_scenes_objects" ADD COLUMN "ocr_product_name" varchar;
  ALTER TABLE "video_scenes_objects" ADD COLUMN "ocr_text" varchar;
  ALTER TABLE "video_scenes_detections" ADD COLUMN "reasoning" varchar;
  ALTER TABLE "video_processings" ADD COLUMN "stage_ocr_extraction" boolean DEFAULT true;
  ALTER TABLE "video_scenes_objects" DROP COLUMN "side";
  ALTER TABLE "video_scenes_objects" DROP COLUMN "cluster_group";
  ALTER TABLE "video_scenes_objects" DROP COLUMN "is_representative";
  ALTER TABLE "video_processings" DROP COLUMN "stage_side_detection";
  DROP TYPE "public"."enum_video_scenes_objects_side";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_video_scenes_objects_side" AS ENUM('front', 'back', 'unknown');
  ALTER TABLE "video_scenes_detections_sources" ALTER COLUMN "value" SET DATA TYPE text;
  DROP TYPE "public"."enum_video_scenes_detections_sources";
  CREATE TYPE "public"."enum_video_scenes_detections_sources" AS ENUM('barcode', 'object_detection', 'vision_llm');
  ALTER TABLE "video_scenes_detections_sources" ALTER COLUMN "value" SET DATA TYPE "public"."enum_video_scenes_detections_sources" USING "value"::"public"."enum_video_scenes_detections_sources";
  ALTER TABLE "video_mentions_sources" ALTER COLUMN "value" SET DATA TYPE text;
  DROP TYPE "public"."enum_video_mentions_sources";
  CREATE TYPE "public"."enum_video_mentions_sources" AS ENUM('barcode', 'object_detection', 'vision_llm');
  ALTER TABLE "video_mentions_sources" ALTER COLUMN "value" SET DATA TYPE "public"."enum_video_mentions_sources" USING "value"::"public"."enum_video_mentions_sources";
  ALTER TABLE "video_processings" ALTER COLUMN "search_threshold" SET DEFAULT 0.3;
  ALTER TABLE "video_processings" ALTER COLUMN "search_limit" SET DEFAULT 1;
  ALTER TABLE "video_scenes_objects" ADD COLUMN "side" "enum_video_scenes_objects_side";
  ALTER TABLE "video_scenes_objects" ADD COLUMN "cluster_group" numeric;
  ALTER TABLE "video_scenes_objects" ADD COLUMN "is_representative" boolean;
  ALTER TABLE "video_processings" ADD COLUMN "stage_side_detection" boolean DEFAULT true;
  ALTER TABLE "video_scenes_objects" DROP COLUMN "ocr_brand";
  ALTER TABLE "video_scenes_objects" DROP COLUMN "ocr_product_name";
  ALTER TABLE "video_scenes_objects" DROP COLUMN "ocr_text";
  ALTER TABLE "video_scenes_detections" DROP COLUMN "reasoning";
  ALTER TABLE "video_processings" DROP COLUMN "stage_ocr_extraction";`)
}
