import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_galleries_status" AS ENUM('discovered', 'crawled', 'processed');
  CREATE TYPE "public"."enum_gallery_items_detections_sources" AS ENUM('barcode', 'object_detection', 'vision_llm', 'ocr', 'caption');
  CREATE TYPE "public"."enum_gallery_mentions_sources" AS ENUM('barcode', 'object_detection', 'vision_llm', 'ocr', 'caption');
  CREATE TYPE "public"."enum_gallery_mentions_quotes_sentiment" AS ENUM('positive', 'neutral', 'negative', 'mixed');
  CREATE TYPE "public"."enum_gallery_mentions_overall_sentiment" AS ENUM('positive', 'neutral', 'negative', 'mixed');
  CREATE TYPE "public"."enum_gallery_discoveries_status" AS ENUM('pending', 'scheduled', 'in_progress', 'completed', 'failed');
  CREATE TYPE "public"."enum_gallery_crawls_status" AS ENUM('pending', 'scheduled', 'in_progress', 'completed', 'failed');
  CREATE TYPE "public"."enum_gallery_crawls_type" AS ENUM('all', 'selected_urls', 'from_discovery');
  CREATE TYPE "public"."enum_gallery_crawls_scope" AS ENUM('uncrawled_only', 'recrawl');
  CREATE TYPE "public"."enum_gallery_processings_status" AS ENUM('pending', 'scheduled', 'in_progress', 'completed', 'failed');
  CREATE TYPE "public"."enum_gallery_processings_type" AS ENUM('all_unprocessed', 'single_gallery', 'selected_urls', 'from_crawl');
  CREATE TABLE "gallery_media" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"alt" varchar NOT NULL,
  	"prefix" varchar DEFAULT 'dev/gallery-media',
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"url" varchar,
  	"thumbnail_u_r_l" varchar,
  	"filename" varchar,
  	"mime_type" varchar,
  	"filesize" numeric,
  	"width" numeric,
  	"height" numeric,
  	"focal_x" numeric,
  	"focal_y" numeric,
  	"sizes_thumbnail_url" varchar,
  	"sizes_thumbnail_width" numeric,
  	"sizes_thumbnail_height" numeric,
  	"sizes_thumbnail_mime_type" varchar,
  	"sizes_thumbnail_filesize" numeric,
  	"sizes_thumbnail_filename" varchar,
  	"sizes_card_url" varchar,
  	"sizes_card_width" numeric,
  	"sizes_card_height" numeric,
  	"sizes_card_mime_type" varchar,
  	"sizes_card_filesize" numeric,
  	"sizes_card_filename" varchar,
  	"sizes_detail_url" varchar,
  	"sizes_detail_width" numeric,
  	"sizes_detail_height" numeric,
  	"sizes_detail_mime_type" varchar,
  	"sizes_detail_filesize" numeric,
  	"sizes_detail_filename" varchar
  );
  
  CREATE TABLE "galleries" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"status" "enum_galleries_status" DEFAULT 'discovered',
  	"channel_id" integer NOT NULL,
  	"external_url" varchar,
  	"external_id" varchar,
  	"published_at" timestamp(3) with time zone,
  	"like_count" numeric,
  	"comment_count" numeric,
  	"caption" varchar,
  	"comments" jsonb,
  	"thumbnail_id" integer,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "gallery_items_barcodes" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"barcode" varchar NOT NULL,
  	"product_variant_id" integer,
  	"product_id" integer
  );
  
  CREATE TABLE "gallery_items_objects" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"crop_id" integer NOT NULL,
  	"score" numeric,
  	"box_x_min" numeric,
  	"box_y_min" numeric,
  	"box_x_max" numeric,
  	"box_y_max" numeric,
  	"ocr_brand" varchar,
  	"ocr_product_name" varchar,
  	"ocr_text" varchar
  );
  
  CREATE TABLE "gallery_items_recognitions" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"object" varchar,
  	"product_id" integer,
  	"product_variant_id" integer,
  	"gtin" varchar,
  	"distance" numeric
  );
  
  CREATE TABLE "gallery_items_detections_sources" (
  	"order" integer NOT NULL,
  	"parent_id" varchar NOT NULL,
  	"value" "enum_gallery_items_detections_sources",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  CREATE TABLE "gallery_items_detections" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"product_id" integer NOT NULL,
  	"confidence" numeric,
  	"barcode_value" varchar,
  	"clip_distance" numeric,
  	"llm_brand" varchar,
  	"llm_product_name" varchar,
  	"reasoning" varchar
  );
  
  CREATE TABLE "gallery_items" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"gallery_id" integer NOT NULL,
  	"position" numeric DEFAULT 0,
  	"image_id" integer,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "gallery_mentions_sources" (
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"value" "enum_gallery_mentions_sources",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  CREATE TABLE "gallery_mentions_quotes_summary" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"text" varchar NOT NULL
  );
  
  CREATE TABLE "gallery_mentions_quotes" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"text" varchar NOT NULL,
  	"sentiment" "enum_gallery_mentions_quotes_sentiment" NOT NULL,
  	"sentiment_score" numeric
  );
  
  CREATE TABLE "gallery_mentions" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"gallery_item_id" integer NOT NULL,
  	"gallery_id" integer,
  	"product_id" integer NOT NULL,
  	"confidence" numeric,
  	"barcode_value" varchar,
  	"clip_distance" numeric,
  	"overall_sentiment" "enum_gallery_mentions_overall_sentiment",
  	"overall_sentiment_score" numeric,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "gallery_discoveries" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"status" "enum_gallery_discoveries_status" DEFAULT 'pending',
  	"retry_count" numeric DEFAULT 0,
  	"max_retries" numeric DEFAULT 3,
  	"schedule" varchar,
  	"schedule_limit" numeric DEFAULT 0,
  	"schedule_count" numeric DEFAULT 0,
  	"scheduled_for" timestamp(3) with time zone,
  	"gallery_urls" varchar,
  	"channel_url" varchar NOT NULL,
  	"max_galleries" numeric,
  	"date_limit" varchar,
  	"debug_mode" boolean DEFAULT false,
  	"claimed_at" timestamp(3) with time zone,
  	"claimed_by_id" integer,
  	"total" numeric DEFAULT 0,
  	"completed" numeric DEFAULT 0,
  	"errors" numeric DEFAULT 0,
  	"started_at" timestamp(3) with time zone,
  	"completed_at" timestamp(3) with time zone,
  	"progress" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "gallery_crawls" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"status" "enum_gallery_crawls_status" DEFAULT 'pending',
  	"retry_count" numeric DEFAULT 0,
  	"schedule" varchar,
  	"schedule_limit" numeric DEFAULT 0,
  	"schedule_count" numeric DEFAULT 0,
  	"scheduled_for" timestamp(3) with time zone,
  	"type" "enum_gallery_crawls_type" DEFAULT 'all' NOT NULL,
  	"scope" "enum_gallery_crawls_scope" DEFAULT 'uncrawled_only',
  	"urls" varchar,
  	"discovery_id" integer,
  	"max_retries" numeric DEFAULT 3,
  	"claimed_at" timestamp(3) with time zone,
  	"claimed_by_id" integer,
  	"total" numeric DEFAULT 0,
  	"completed" numeric DEFAULT 0,
  	"errors" numeric DEFAULT 0,
  	"started_at" timestamp(3) with time zone,
  	"completed_at" timestamp(3) with time zone,
  	"crawl_progress" jsonb,
  	"crawled_gallery_urls" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "gallery_processings" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"status" "enum_gallery_processings_status" DEFAULT 'pending',
  	"retry_count" numeric DEFAULT 0,
  	"schedule" varchar,
  	"schedule_limit" numeric DEFAULT 0,
  	"schedule_count" numeric DEFAULT 0,
  	"scheduled_for" timestamp(3) with time zone,
  	"type" "enum_gallery_processings_type" DEFAULT 'all_unprocessed' NOT NULL,
  	"gallery_id" integer,
  	"urls" varchar,
  	"crawl_id" integer,
  	"stage_barcode_scan" boolean DEFAULT true,
  	"stage_object_detection" boolean DEFAULT true,
  	"stage_ocr_extraction" boolean DEFAULT true,
  	"stage_visual_search" boolean DEFAULT true,
  	"stage_compile_detections" boolean DEFAULT true,
  	"stage_sentiment_analysis" boolean DEFAULT true,
  	"max_retries" numeric DEFAULT 3,
  	"detection_threshold" numeric DEFAULT 0.3,
  	"min_box_area" numeric DEFAULT 25,
  	"detection_prompt" varchar DEFAULT 'cosmetics packaging.',
  	"search_threshold" numeric DEFAULT 0.8,
  	"search_limit" numeric DEFAULT 3,
  	"claimed_at" timestamp(3) with time zone,
  	"claimed_by_id" integer,
  	"total" numeric DEFAULT 0,
  	"completed" numeric DEFAULT 0,
  	"errors" numeric DEFAULT 0,
  	"started_at" timestamp(3) with time zone,
  	"completed_at" timestamp(3) with time zone,
  	"tokens_used" numeric DEFAULT 0,
  	"gallery_progress" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "events_rels" ADD COLUMN "gallery_discoveries_id" integer;
  ALTER TABLE "events_rels" ADD COLUMN "gallery_crawls_id" integer;
  ALTER TABLE "events_rels" ADD COLUMN "gallery_processings_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "gallery_media_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "galleries_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "gallery_items_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "gallery_mentions_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "gallery_discoveries_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "gallery_crawls_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "gallery_processings_id" integer;
  ALTER TABLE "galleries" ADD CONSTRAINT "galleries_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "galleries" ADD CONSTRAINT "galleries_thumbnail_id_gallery_media_id_fk" FOREIGN KEY ("thumbnail_id") REFERENCES "public"."gallery_media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "gallery_items_barcodes" ADD CONSTRAINT "gallery_items_barcodes_product_variant_id_product_variants_id_fk" FOREIGN KEY ("product_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "gallery_items_barcodes" ADD CONSTRAINT "gallery_items_barcodes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "gallery_items_barcodes" ADD CONSTRAINT "gallery_items_barcodes_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."gallery_items"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "gallery_items_objects" ADD CONSTRAINT "gallery_items_objects_crop_id_detection_media_id_fk" FOREIGN KEY ("crop_id") REFERENCES "public"."detection_media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "gallery_items_objects" ADD CONSTRAINT "gallery_items_objects_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."gallery_items"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "gallery_items_recognitions" ADD CONSTRAINT "gallery_items_recognitions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "gallery_items_recognitions" ADD CONSTRAINT "gallery_items_recognitions_product_variant_id_product_variants_id_fk" FOREIGN KEY ("product_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "gallery_items_recognitions" ADD CONSTRAINT "gallery_items_recognitions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."gallery_items"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "gallery_items_detections_sources" ADD CONSTRAINT "gallery_items_detections_sources_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."gallery_items_detections"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "gallery_items_detections" ADD CONSTRAINT "gallery_items_detections_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "gallery_items_detections" ADD CONSTRAINT "gallery_items_detections_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."gallery_items"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "gallery_items" ADD CONSTRAINT "gallery_items_gallery_id_galleries_id_fk" FOREIGN KEY ("gallery_id") REFERENCES "public"."galleries"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "gallery_items" ADD CONSTRAINT "gallery_items_image_id_gallery_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."gallery_media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "gallery_mentions_sources" ADD CONSTRAINT "gallery_mentions_sources_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."gallery_mentions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "gallery_mentions_quotes_summary" ADD CONSTRAINT "gallery_mentions_quotes_summary_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."gallery_mentions_quotes"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "gallery_mentions_quotes" ADD CONSTRAINT "gallery_mentions_quotes_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."gallery_mentions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "gallery_mentions" ADD CONSTRAINT "gallery_mentions_gallery_item_id_gallery_items_id_fk" FOREIGN KEY ("gallery_item_id") REFERENCES "public"."gallery_items"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "gallery_mentions" ADD CONSTRAINT "gallery_mentions_gallery_id_galleries_id_fk" FOREIGN KEY ("gallery_id") REFERENCES "public"."galleries"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "gallery_mentions" ADD CONSTRAINT "gallery_mentions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "gallery_discoveries" ADD CONSTRAINT "gallery_discoveries_claimed_by_id_workers_id_fk" FOREIGN KEY ("claimed_by_id") REFERENCES "public"."workers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "gallery_crawls" ADD CONSTRAINT "gallery_crawls_discovery_id_gallery_discoveries_id_fk" FOREIGN KEY ("discovery_id") REFERENCES "public"."gallery_discoveries"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "gallery_crawls" ADD CONSTRAINT "gallery_crawls_claimed_by_id_workers_id_fk" FOREIGN KEY ("claimed_by_id") REFERENCES "public"."workers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "gallery_processings" ADD CONSTRAINT "gallery_processings_gallery_id_galleries_id_fk" FOREIGN KEY ("gallery_id") REFERENCES "public"."galleries"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "gallery_processings" ADD CONSTRAINT "gallery_processings_crawl_id_gallery_crawls_id_fk" FOREIGN KEY ("crawl_id") REFERENCES "public"."gallery_crawls"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "gallery_processings" ADD CONSTRAINT "gallery_processings_claimed_by_id_workers_id_fk" FOREIGN KEY ("claimed_by_id") REFERENCES "public"."workers"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "gallery_media_updated_at_idx" ON "gallery_media" USING btree ("updated_at");
  CREATE INDEX "gallery_media_created_at_idx" ON "gallery_media" USING btree ("created_at");
  CREATE UNIQUE INDEX "gallery_media_filename_idx" ON "gallery_media" USING btree ("filename");
  CREATE INDEX "gallery_media_sizes_thumbnail_sizes_thumbnail_filename_idx" ON "gallery_media" USING btree ("sizes_thumbnail_filename");
  CREATE INDEX "gallery_media_sizes_card_sizes_card_filename_idx" ON "gallery_media" USING btree ("sizes_card_filename");
  CREATE INDEX "gallery_media_sizes_detail_sizes_detail_filename_idx" ON "gallery_media" USING btree ("sizes_detail_filename");
  CREATE INDEX "galleries_status_idx" ON "galleries" USING btree ("status");
  CREATE INDEX "galleries_channel_idx" ON "galleries" USING btree ("channel_id");
  CREATE UNIQUE INDEX "galleries_external_url_idx" ON "galleries" USING btree ("external_url");
  CREATE INDEX "galleries_thumbnail_idx" ON "galleries" USING btree ("thumbnail_id");
  CREATE INDEX "galleries_updated_at_idx" ON "galleries" USING btree ("updated_at");
  CREATE INDEX "galleries_created_at_idx" ON "galleries" USING btree ("created_at");
  CREATE INDEX "gallery_items_barcodes_order_idx" ON "gallery_items_barcodes" USING btree ("_order");
  CREATE INDEX "gallery_items_barcodes_parent_id_idx" ON "gallery_items_barcodes" USING btree ("_parent_id");
  CREATE INDEX "gallery_items_barcodes_product_variant_idx" ON "gallery_items_barcodes" USING btree ("product_variant_id");
  CREATE INDEX "gallery_items_barcodes_product_idx" ON "gallery_items_barcodes" USING btree ("product_id");
  CREATE INDEX "gallery_items_objects_order_idx" ON "gallery_items_objects" USING btree ("_order");
  CREATE INDEX "gallery_items_objects_parent_id_idx" ON "gallery_items_objects" USING btree ("_parent_id");
  CREATE INDEX "gallery_items_objects_crop_idx" ON "gallery_items_objects" USING btree ("crop_id");
  CREATE INDEX "gallery_items_recognitions_order_idx" ON "gallery_items_recognitions" USING btree ("_order");
  CREATE INDEX "gallery_items_recognitions_parent_id_idx" ON "gallery_items_recognitions" USING btree ("_parent_id");
  CREATE INDEX "gallery_items_recognitions_product_idx" ON "gallery_items_recognitions" USING btree ("product_id");
  CREATE INDEX "gallery_items_recognitions_product_variant_idx" ON "gallery_items_recognitions" USING btree ("product_variant_id");
  CREATE INDEX "gallery_items_detections_sources_order_idx" ON "gallery_items_detections_sources" USING btree ("order");
  CREATE INDEX "gallery_items_detections_sources_parent_idx" ON "gallery_items_detections_sources" USING btree ("parent_id");
  CREATE INDEX "gallery_items_detections_order_idx" ON "gallery_items_detections" USING btree ("_order");
  CREATE INDEX "gallery_items_detections_parent_id_idx" ON "gallery_items_detections" USING btree ("_parent_id");
  CREATE INDEX "gallery_items_detections_product_idx" ON "gallery_items_detections" USING btree ("product_id");
  CREATE INDEX "gallery_items_gallery_idx" ON "gallery_items" USING btree ("gallery_id");
  CREATE INDEX "gallery_items_image_idx" ON "gallery_items" USING btree ("image_id");
  CREATE INDEX "gallery_items_updated_at_idx" ON "gallery_items" USING btree ("updated_at");
  CREATE INDEX "gallery_items_created_at_idx" ON "gallery_items" USING btree ("created_at");
  CREATE INDEX "gallery_mentions_sources_order_idx" ON "gallery_mentions_sources" USING btree ("order");
  CREATE INDEX "gallery_mentions_sources_parent_idx" ON "gallery_mentions_sources" USING btree ("parent_id");
  CREATE INDEX "gallery_mentions_quotes_summary_order_idx" ON "gallery_mentions_quotes_summary" USING btree ("_order");
  CREATE INDEX "gallery_mentions_quotes_summary_parent_id_idx" ON "gallery_mentions_quotes_summary" USING btree ("_parent_id");
  CREATE INDEX "gallery_mentions_quotes_order_idx" ON "gallery_mentions_quotes" USING btree ("_order");
  CREATE INDEX "gallery_mentions_quotes_parent_id_idx" ON "gallery_mentions_quotes" USING btree ("_parent_id");
  CREATE INDEX "gallery_mentions_gallery_item_idx" ON "gallery_mentions" USING btree ("gallery_item_id");
  CREATE INDEX "gallery_mentions_gallery_idx" ON "gallery_mentions" USING btree ("gallery_id");
  CREATE INDEX "gallery_mentions_product_idx" ON "gallery_mentions" USING btree ("product_id");
  CREATE INDEX "gallery_mentions_updated_at_idx" ON "gallery_mentions" USING btree ("updated_at");
  CREATE INDEX "gallery_mentions_created_at_idx" ON "gallery_mentions" USING btree ("created_at");
  CREATE INDEX "gallery_discoveries_status_idx" ON "gallery_discoveries" USING btree ("status");
  CREATE INDEX "gallery_discoveries_claimed_by_idx" ON "gallery_discoveries" USING btree ("claimed_by_id");
  CREATE INDEX "gallery_discoveries_updated_at_idx" ON "gallery_discoveries" USING btree ("updated_at");
  CREATE INDEX "gallery_discoveries_created_at_idx" ON "gallery_discoveries" USING btree ("created_at");
  CREATE INDEX "gallery_crawls_status_idx" ON "gallery_crawls" USING btree ("status");
  CREATE INDEX "gallery_crawls_discovery_idx" ON "gallery_crawls" USING btree ("discovery_id");
  CREATE INDEX "gallery_crawls_claimed_by_idx" ON "gallery_crawls" USING btree ("claimed_by_id");
  CREATE INDEX "gallery_crawls_updated_at_idx" ON "gallery_crawls" USING btree ("updated_at");
  CREATE INDEX "gallery_crawls_created_at_idx" ON "gallery_crawls" USING btree ("created_at");
  CREATE INDEX "gallery_processings_status_idx" ON "gallery_processings" USING btree ("status");
  CREATE INDEX "gallery_processings_gallery_idx" ON "gallery_processings" USING btree ("gallery_id");
  CREATE INDEX "gallery_processings_crawl_idx" ON "gallery_processings" USING btree ("crawl_id");
  CREATE INDEX "gallery_processings_claimed_by_idx" ON "gallery_processings" USING btree ("claimed_by_id");
  CREATE INDEX "gallery_processings_updated_at_idx" ON "gallery_processings" USING btree ("updated_at");
  CREATE INDEX "gallery_processings_created_at_idx" ON "gallery_processings" USING btree ("created_at");
  ALTER TABLE "events_rels" ADD CONSTRAINT "events_rels_gallery_discoveries_fk" FOREIGN KEY ("gallery_discoveries_id") REFERENCES "public"."gallery_discoveries"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "events_rels" ADD CONSTRAINT "events_rels_gallery_crawls_fk" FOREIGN KEY ("gallery_crawls_id") REFERENCES "public"."gallery_crawls"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "events_rels" ADD CONSTRAINT "events_rels_gallery_processings_fk" FOREIGN KEY ("gallery_processings_id") REFERENCES "public"."gallery_processings"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_gallery_media_fk" FOREIGN KEY ("gallery_media_id") REFERENCES "public"."gallery_media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_galleries_fk" FOREIGN KEY ("galleries_id") REFERENCES "public"."galleries"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_gallery_items_fk" FOREIGN KEY ("gallery_items_id") REFERENCES "public"."gallery_items"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_gallery_mentions_fk" FOREIGN KEY ("gallery_mentions_id") REFERENCES "public"."gallery_mentions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_gallery_discoveries_fk" FOREIGN KEY ("gallery_discoveries_id") REFERENCES "public"."gallery_discoveries"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_gallery_crawls_fk" FOREIGN KEY ("gallery_crawls_id") REFERENCES "public"."gallery_crawls"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_gallery_processings_fk" FOREIGN KEY ("gallery_processings_id") REFERENCES "public"."gallery_processings"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "events_rels_gallery_discoveries_id_idx" ON "events_rels" USING btree ("gallery_discoveries_id");
  CREATE INDEX "events_rels_gallery_crawls_id_idx" ON "events_rels" USING btree ("gallery_crawls_id");
  CREATE INDEX "events_rels_gallery_processings_id_idx" ON "events_rels" USING btree ("gallery_processings_id");
  CREATE INDEX "payload_locked_documents_rels_gallery_media_id_idx" ON "payload_locked_documents_rels" USING btree ("gallery_media_id");
  CREATE INDEX "payload_locked_documents_rels_galleries_id_idx" ON "payload_locked_documents_rels" USING btree ("galleries_id");
  CREATE INDEX "payload_locked_documents_rels_gallery_items_id_idx" ON "payload_locked_documents_rels" USING btree ("gallery_items_id");
  CREATE INDEX "payload_locked_documents_rels_gallery_mentions_id_idx" ON "payload_locked_documents_rels" USING btree ("gallery_mentions_id");
  CREATE INDEX "payload_locked_documents_rels_gallery_discoveries_id_idx" ON "payload_locked_documents_rels" USING btree ("gallery_discoveries_id");
  CREATE INDEX "payload_locked_documents_rels_gallery_crawls_id_idx" ON "payload_locked_documents_rels" USING btree ("gallery_crawls_id");
  CREATE INDEX "payload_locked_documents_rels_gallery_processings_id_idx" ON "payload_locked_documents_rels" USING btree ("gallery_processings_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "gallery_media" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "galleries" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "gallery_items_barcodes" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "gallery_items_objects" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "gallery_items_recognitions" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "gallery_items_detections_sources" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "gallery_items_detections" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "gallery_items" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "gallery_mentions_sources" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "gallery_mentions_quotes_summary" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "gallery_mentions_quotes" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "gallery_mentions" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "gallery_discoveries" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "gallery_crawls" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "gallery_processings" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "gallery_media" CASCADE;
  DROP TABLE "galleries" CASCADE;
  DROP TABLE "gallery_items_barcodes" CASCADE;
  DROP TABLE "gallery_items_objects" CASCADE;
  DROP TABLE "gallery_items_recognitions" CASCADE;
  DROP TABLE "gallery_items_detections_sources" CASCADE;
  DROP TABLE "gallery_items_detections" CASCADE;
  DROP TABLE "gallery_items" CASCADE;
  DROP TABLE "gallery_mentions_sources" CASCADE;
  DROP TABLE "gallery_mentions_quotes_summary" CASCADE;
  DROP TABLE "gallery_mentions_quotes" CASCADE;
  DROP TABLE "gallery_mentions" CASCADE;
  DROP TABLE "gallery_discoveries" CASCADE;
  DROP TABLE "gallery_crawls" CASCADE;
  DROP TABLE "gallery_processings" CASCADE;
  ALTER TABLE "events_rels" DROP CONSTRAINT "events_rels_gallery_discoveries_fk";
  
  ALTER TABLE "events_rels" DROP CONSTRAINT "events_rels_gallery_crawls_fk";
  
  ALTER TABLE "events_rels" DROP CONSTRAINT "events_rels_gallery_processings_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_gallery_media_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_galleries_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_gallery_items_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_gallery_mentions_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_gallery_discoveries_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_gallery_crawls_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_gallery_processings_fk";
  
  DROP INDEX "events_rels_gallery_discoveries_id_idx";
  DROP INDEX "events_rels_gallery_crawls_id_idx";
  DROP INDEX "events_rels_gallery_processings_id_idx";
  DROP INDEX "payload_locked_documents_rels_gallery_media_id_idx";
  DROP INDEX "payload_locked_documents_rels_galleries_id_idx";
  DROP INDEX "payload_locked_documents_rels_gallery_items_id_idx";
  DROP INDEX "payload_locked_documents_rels_gallery_mentions_id_idx";
  DROP INDEX "payload_locked_documents_rels_gallery_discoveries_id_idx";
  DROP INDEX "payload_locked_documents_rels_gallery_crawls_id_idx";
  DROP INDEX "payload_locked_documents_rels_gallery_processings_id_idx";
  ALTER TABLE "events_rels" DROP COLUMN "gallery_discoveries_id";
  ALTER TABLE "events_rels" DROP COLUMN "gallery_crawls_id";
  ALTER TABLE "events_rels" DROP COLUMN "gallery_processings_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "gallery_media_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "galleries_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "gallery_items_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "gallery_mentions_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "gallery_discoveries_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "gallery_crawls_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "gallery_processings_id";
  DROP TYPE "public"."enum_galleries_status";
  DROP TYPE "public"."enum_gallery_items_detections_sources";
  DROP TYPE "public"."enum_gallery_mentions_sources";
  DROP TYPE "public"."enum_gallery_mentions_quotes_sentiment";
  DROP TYPE "public"."enum_gallery_mentions_overall_sentiment";
  DROP TYPE "public"."enum_gallery_discoveries_status";
  DROP TYPE "public"."enum_gallery_crawls_status";
  DROP TYPE "public"."enum_gallery_crawls_type";
  DROP TYPE "public"."enum_gallery_crawls_scope";
  DROP TYPE "public"."enum_gallery_processings_status";
  DROP TYPE "public"."enum_gallery_processings_type";`)
}
