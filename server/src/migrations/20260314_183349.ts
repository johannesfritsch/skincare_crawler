import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_video_scenes_detections_sources" AS ENUM('barcode', 'object_detection', 'vision_llm');
  CREATE TYPE "public"."enum_video_mentions_sources" AS ENUM('barcode', 'object_detection', 'vision_llm');
  CREATE TABLE "video_scenes_barcodes" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"barcode" varchar NOT NULL,
  	"frame_id" integer,
  	"product_variant_id" integer,
  	"product_id" integer
  );
  
  CREATE TABLE "video_scenes_objects" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"frame_id" integer,
  	"crop_id" integer NOT NULL,
  	"score" numeric,
  	"box_x_min" numeric,
  	"box_y_min" numeric,
  	"box_x_max" numeric,
  	"box_y_max" numeric
  );
  
  CREATE TABLE "video_scenes_recognitions" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"object_index" numeric,
  	"product_id" integer,
  	"product_variant_id" integer,
  	"gtin" varchar,
  	"distance" numeric
  );
  
  CREATE TABLE "video_scenes_llm_matches" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"frame_id" integer,
  	"brand" varchar,
  	"product_name" varchar,
  	"search_terms" jsonb,
  	"product_id" integer
  );
  
  CREATE TABLE "video_scenes_detections_sources" (
  	"order" integer NOT NULL,
  	"parent_id" varchar NOT NULL,
  	"value" "enum_video_scenes_detections_sources",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  CREATE TABLE "video_scenes_detections" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"product_id" integer NOT NULL,
  	"confidence" numeric,
  	"barcode_value" varchar,
  	"clip_distance" numeric,
  	"llm_brand" varchar,
  	"llm_product_name" varchar
  );
  
  CREATE TABLE "video_mentions_sources" (
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"value" "enum_video_mentions_sources",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  ALTER TABLE "video_scenes_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "video_frames_detections" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "video_scenes_rels" CASCADE;
  DROP TABLE "video_frames_detections" CASCADE;
  ALTER TABLE "video_frames" DROP CONSTRAINT "video_frames_recognition_thumbnail_id_video_media_id_fk";
  
  DROP INDEX "video_frames_recognition_thumbnail_idx";
  ALTER TABLE "video_frames" ADD COLUMN "is_cluster_representative" boolean;
  ALTER TABLE "video_frames" ADD COLUMN "cluster_thumbnail_id" integer;
  ALTER TABLE "video_mentions" ADD COLUMN "confidence" numeric;
  ALTER TABLE "video_mentions" ADD COLUMN "barcode_value" varchar;
  ALTER TABLE "video_mentions" ADD COLUMN "clip_distance" numeric;
  ALTER TABLE "video_processings" ADD COLUMN "stage_barcode_scan" boolean DEFAULT true;
  ALTER TABLE "video_processings" ADD COLUMN "stage_object_detection" boolean DEFAULT true;
  ALTER TABLE "video_processings" ADD COLUMN "stage_visual_search" boolean DEFAULT true;
  ALTER TABLE "video_processings" ADD COLUMN "stage_llm_recognition" boolean DEFAULT true;
  ALTER TABLE "video_processings" ADD COLUMN "stage_compile_detections" boolean DEFAULT true;
  ALTER TABLE "video_scenes_barcodes" ADD CONSTRAINT "video_scenes_barcodes_frame_id_video_frames_id_fk" FOREIGN KEY ("frame_id") REFERENCES "public"."video_frames"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "video_scenes_barcodes" ADD CONSTRAINT "video_scenes_barcodes_product_variant_id_product_variants_id_fk" FOREIGN KEY ("product_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "video_scenes_barcodes" ADD CONSTRAINT "video_scenes_barcodes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "video_scenes_barcodes" ADD CONSTRAINT "video_scenes_barcodes_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."video_scenes"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "video_scenes_objects" ADD CONSTRAINT "video_scenes_objects_frame_id_video_frames_id_fk" FOREIGN KEY ("frame_id") REFERENCES "public"."video_frames"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "video_scenes_objects" ADD CONSTRAINT "video_scenes_objects_crop_id_detection_media_id_fk" FOREIGN KEY ("crop_id") REFERENCES "public"."detection_media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "video_scenes_objects" ADD CONSTRAINT "video_scenes_objects_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."video_scenes"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "video_scenes_recognitions" ADD CONSTRAINT "video_scenes_recognitions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "video_scenes_recognitions" ADD CONSTRAINT "video_scenes_recognitions_product_variant_id_product_variants_id_fk" FOREIGN KEY ("product_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "video_scenes_recognitions" ADD CONSTRAINT "video_scenes_recognitions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."video_scenes"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "video_scenes_llm_matches" ADD CONSTRAINT "video_scenes_llm_matches_frame_id_video_frames_id_fk" FOREIGN KEY ("frame_id") REFERENCES "public"."video_frames"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "video_scenes_llm_matches" ADD CONSTRAINT "video_scenes_llm_matches_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "video_scenes_llm_matches" ADD CONSTRAINT "video_scenes_llm_matches_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."video_scenes"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "video_scenes_detections_sources" ADD CONSTRAINT "video_scenes_detections_sources_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."video_scenes_detections"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "video_scenes_detections" ADD CONSTRAINT "video_scenes_detections_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "video_scenes_detections" ADD CONSTRAINT "video_scenes_detections_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."video_scenes"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "video_mentions_sources" ADD CONSTRAINT "video_mentions_sources_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."video_mentions"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "video_scenes_barcodes_order_idx" ON "video_scenes_barcodes" USING btree ("_order");
  CREATE INDEX "video_scenes_barcodes_parent_id_idx" ON "video_scenes_barcodes" USING btree ("_parent_id");
  CREATE INDEX "video_scenes_barcodes_frame_idx" ON "video_scenes_barcodes" USING btree ("frame_id");
  CREATE INDEX "video_scenes_barcodes_product_variant_idx" ON "video_scenes_barcodes" USING btree ("product_variant_id");
  CREATE INDEX "video_scenes_barcodes_product_idx" ON "video_scenes_barcodes" USING btree ("product_id");
  CREATE INDEX "video_scenes_objects_order_idx" ON "video_scenes_objects" USING btree ("_order");
  CREATE INDEX "video_scenes_objects_parent_id_idx" ON "video_scenes_objects" USING btree ("_parent_id");
  CREATE INDEX "video_scenes_objects_frame_idx" ON "video_scenes_objects" USING btree ("frame_id");
  CREATE INDEX "video_scenes_objects_crop_idx" ON "video_scenes_objects" USING btree ("crop_id");
  CREATE INDEX "video_scenes_recognitions_order_idx" ON "video_scenes_recognitions" USING btree ("_order");
  CREATE INDEX "video_scenes_recognitions_parent_id_idx" ON "video_scenes_recognitions" USING btree ("_parent_id");
  CREATE INDEX "video_scenes_recognitions_product_idx" ON "video_scenes_recognitions" USING btree ("product_id");
  CREATE INDEX "video_scenes_recognitions_product_variant_idx" ON "video_scenes_recognitions" USING btree ("product_variant_id");
  CREATE INDEX "video_scenes_llm_matches_order_idx" ON "video_scenes_llm_matches" USING btree ("_order");
  CREATE INDEX "video_scenes_llm_matches_parent_id_idx" ON "video_scenes_llm_matches" USING btree ("_parent_id");
  CREATE INDEX "video_scenes_llm_matches_frame_idx" ON "video_scenes_llm_matches" USING btree ("frame_id");
  CREATE INDEX "video_scenes_llm_matches_product_idx" ON "video_scenes_llm_matches" USING btree ("product_id");
  CREATE INDEX "video_scenes_detections_sources_order_idx" ON "video_scenes_detections_sources" USING btree ("order");
  CREATE INDEX "video_scenes_detections_sources_parent_idx" ON "video_scenes_detections_sources" USING btree ("parent_id");
  CREATE INDEX "video_scenes_detections_order_idx" ON "video_scenes_detections" USING btree ("_order");
  CREATE INDEX "video_scenes_detections_parent_id_idx" ON "video_scenes_detections" USING btree ("_parent_id");
  CREATE INDEX "video_scenes_detections_product_idx" ON "video_scenes_detections" USING btree ("product_id");
  CREATE INDEX "video_mentions_sources_order_idx" ON "video_mentions_sources" USING btree ("order");
  CREATE INDEX "video_mentions_sources_parent_idx" ON "video_mentions_sources" USING btree ("parent_id");
  ALTER TABLE "video_frames" ADD CONSTRAINT "video_frames_cluster_thumbnail_id_video_media_id_fk" FOREIGN KEY ("cluster_thumbnail_id") REFERENCES "public"."video_media"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "video_frames_cluster_thumbnail_idx" ON "video_frames" USING btree ("cluster_thumbnail_id");
  ALTER TABLE "video_scenes" DROP COLUMN "matching_type";
  ALTER TABLE "video_frames" DROP COLUMN "barcode";
  ALTER TABLE "video_frames" DROP COLUMN "recognition_candidate";
  ALTER TABLE "video_frames" DROP COLUMN "recognition_thumbnail_id";
  ALTER TABLE "video_processings" DROP COLUMN "stage_product_recognition";
  ALTER TABLE "video_processings" DROP COLUMN "stage_screenshot_detection";
  ALTER TABLE "video_processings" DROP COLUMN "stage_screenshot_search";
  DROP TYPE "public"."enum_video_scenes_matching_type";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_video_scenes_matching_type" AS ENUM('barcode', 'visual');
  CREATE TABLE "video_scenes_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"products_id" integer
  );
  
  CREATE TABLE "video_frames_detections" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"image_id" integer NOT NULL,
  	"score" numeric,
  	"box_x_min" numeric,
  	"box_y_min" numeric,
  	"box_x_max" numeric,
  	"box_y_max" numeric,
  	"has_embedding" boolean DEFAULT false,
  	"matched_product_id" integer,
  	"match_distance" numeric,
  	"matched_gtin" varchar
  );
  
  ALTER TABLE "video_scenes_barcodes" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "video_scenes_objects" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "video_scenes_recognitions" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "video_scenes_llm_matches" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "video_scenes_detections_sources" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "video_scenes_detections" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "video_mentions_sources" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "video_scenes_barcodes" CASCADE;
  DROP TABLE "video_scenes_objects" CASCADE;
  DROP TABLE "video_scenes_recognitions" CASCADE;
  DROP TABLE "video_scenes_llm_matches" CASCADE;
  DROP TABLE "video_scenes_detections_sources" CASCADE;
  DROP TABLE "video_scenes_detections" CASCADE;
  DROP TABLE "video_mentions_sources" CASCADE;
  ALTER TABLE "video_frames" DROP CONSTRAINT "video_frames_cluster_thumbnail_id_video_media_id_fk";
  
  DROP INDEX "video_frames_cluster_thumbnail_idx";
  ALTER TABLE "video_scenes" ADD COLUMN "matching_type" "enum_video_scenes_matching_type";
  ALTER TABLE "video_frames" ADD COLUMN "barcode" varchar;
  ALTER TABLE "video_frames" ADD COLUMN "recognition_candidate" boolean;
  ALTER TABLE "video_frames" ADD COLUMN "recognition_thumbnail_id" integer;
  ALTER TABLE "video_processings" ADD COLUMN "stage_product_recognition" boolean DEFAULT true;
  ALTER TABLE "video_processings" ADD COLUMN "stage_screenshot_detection" boolean DEFAULT true;
  ALTER TABLE "video_processings" ADD COLUMN "stage_screenshot_search" boolean DEFAULT true;
  ALTER TABLE "video_scenes_rels" ADD CONSTRAINT "video_scenes_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."video_scenes"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "video_scenes_rels" ADD CONSTRAINT "video_scenes_rels_products_fk" FOREIGN KEY ("products_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "video_frames_detections" ADD CONSTRAINT "video_frames_detections_image_id_detection_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."detection_media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "video_frames_detections" ADD CONSTRAINT "video_frames_detections_matched_product_id_products_id_fk" FOREIGN KEY ("matched_product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "video_frames_detections" ADD CONSTRAINT "video_frames_detections_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."video_frames"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "video_scenes_rels_order_idx" ON "video_scenes_rels" USING btree ("order");
  CREATE INDEX "video_scenes_rels_parent_idx" ON "video_scenes_rels" USING btree ("parent_id");
  CREATE INDEX "video_scenes_rels_path_idx" ON "video_scenes_rels" USING btree ("path");
  CREATE INDEX "video_scenes_rels_products_id_idx" ON "video_scenes_rels" USING btree ("products_id");
  CREATE INDEX "video_frames_detections_order_idx" ON "video_frames_detections" USING btree ("_order");
  CREATE INDEX "video_frames_detections_parent_id_idx" ON "video_frames_detections" USING btree ("_parent_id");
  CREATE INDEX "video_frames_detections_image_idx" ON "video_frames_detections" USING btree ("image_id");
  CREATE INDEX "video_frames_detections_matched_product_idx" ON "video_frames_detections" USING btree ("matched_product_id");
  ALTER TABLE "video_frames" ADD CONSTRAINT "video_frames_recognition_thumbnail_id_video_media_id_fk" FOREIGN KEY ("recognition_thumbnail_id") REFERENCES "public"."video_media"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "video_frames_recognition_thumbnail_idx" ON "video_frames" USING btree ("recognition_thumbnail_id");
  ALTER TABLE "video_frames" DROP COLUMN "is_cluster_representative";
  ALTER TABLE "video_frames" DROP COLUMN "cluster_thumbnail_id";
  ALTER TABLE "video_mentions" DROP COLUMN "confidence";
  ALTER TABLE "video_mentions" DROP COLUMN "barcode_value";
  ALTER TABLE "video_mentions" DROP COLUMN "clip_distance";
  ALTER TABLE "video_processings" DROP COLUMN "stage_barcode_scan";
  ALTER TABLE "video_processings" DROP COLUMN "stage_object_detection";
  ALTER TABLE "video_processings" DROP COLUMN "stage_visual_search";
  ALTER TABLE "video_processings" DROP COLUMN "stage_llm_recognition";
  ALTER TABLE "video_processings" DROP COLUMN "stage_compile_detections";
  DROP TYPE "public"."enum_video_scenes_detections_sources";
  DROP TYPE "public"."enum_video_mentions_sources";`)
}
