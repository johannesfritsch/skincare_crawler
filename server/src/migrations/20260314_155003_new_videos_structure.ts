import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
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
  
  CREATE TABLE "video_frames" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"snippet_id" integer NOT NULL,
  	"image_id" integer NOT NULL,
  	"barcode" varchar,
  	"recognition_candidate" boolean,
  	"recognition_thumbnail_id" integer,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "video_snippets_detections" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "video_snippets_screenshots" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "video_snippets_detections" CASCADE;
  DROP TABLE "video_snippets_screenshots" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "video_frames_id" integer;
  ALTER TABLE "video_frames_detections" ADD CONSTRAINT "video_frames_detections_image_id_detection_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."detection_media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "video_frames_detections" ADD CONSTRAINT "video_frames_detections_matched_product_id_products_id_fk" FOREIGN KEY ("matched_product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "video_frames_detections" ADD CONSTRAINT "video_frames_detections_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."video_frames"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "video_frames" ADD CONSTRAINT "video_frames_snippet_id_video_snippets_id_fk" FOREIGN KEY ("snippet_id") REFERENCES "public"."video_snippets"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "video_frames" ADD CONSTRAINT "video_frames_image_id_video_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."video_media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "video_frames" ADD CONSTRAINT "video_frames_recognition_thumbnail_id_video_media_id_fk" FOREIGN KEY ("recognition_thumbnail_id") REFERENCES "public"."video_media"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "video_frames_detections_order_idx" ON "video_frames_detections" USING btree ("_order");
  CREATE INDEX "video_frames_detections_parent_id_idx" ON "video_frames_detections" USING btree ("_parent_id");
  CREATE INDEX "video_frames_detections_image_idx" ON "video_frames_detections" USING btree ("image_id");
  CREATE INDEX "video_frames_detections_matched_product_idx" ON "video_frames_detections" USING btree ("matched_product_id");
  CREATE INDEX "video_frames_snippet_idx" ON "video_frames" USING btree ("snippet_id");
  CREATE INDEX "video_frames_image_idx" ON "video_frames" USING btree ("image_id");
  CREATE INDEX "video_frames_recognition_thumbnail_idx" ON "video_frames" USING btree ("recognition_thumbnail_id");
  CREATE INDEX "video_frames_updated_at_idx" ON "video_frames" USING btree ("updated_at");
  CREATE INDEX "video_frames_created_at_idx" ON "video_frames" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_video_frames_fk" FOREIGN KEY ("video_frames_id") REFERENCES "public"."video_frames"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_video_frames_id_idx" ON "payload_locked_documents_rels" USING btree ("video_frames_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "video_snippets_detections" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"image_id" integer NOT NULL,
  	"score" numeric,
  	"screenshot_index" numeric,
  	"box_x_min" numeric,
  	"box_y_min" numeric,
  	"box_x_max" numeric,
  	"box_y_max" numeric,
  	"has_embedding" boolean DEFAULT false,
  	"matched_product_id" integer,
  	"match_distance" numeric,
  	"matched_gtin" varchar
  );
  
  CREATE TABLE "video_snippets_screenshots" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"image_id" integer NOT NULL,
  	"thumbnail_id" integer,
  	"hash" varchar,
  	"distance" numeric,
  	"screenshot_group" numeric,
  	"barcode" varchar,
  	"recognition_candidate" boolean,
  	"recognition_thumbnail_id" integer
  );
  
  ALTER TABLE "video_frames_detections" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "video_frames" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "video_frames_detections" CASCADE;
  DROP TABLE "video_frames" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_video_frames_fk";
  
  DROP INDEX "payload_locked_documents_rels_video_frames_id_idx";
  ALTER TABLE "video_snippets_detections" ADD CONSTRAINT "video_snippets_detections_image_id_detection_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."detection_media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "video_snippets_detections" ADD CONSTRAINT "video_snippets_detections_matched_product_id_products_id_fk" FOREIGN KEY ("matched_product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "video_snippets_detections" ADD CONSTRAINT "video_snippets_detections_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."video_snippets"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "video_snippets_screenshots" ADD CONSTRAINT "video_snippets_screenshots_image_id_video_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."video_media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "video_snippets_screenshots" ADD CONSTRAINT "video_snippets_screenshots_thumbnail_id_video_media_id_fk" FOREIGN KEY ("thumbnail_id") REFERENCES "public"."video_media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "video_snippets_screenshots" ADD CONSTRAINT "video_snippets_screenshots_recognition_thumbnail_id_video_media_id_fk" FOREIGN KEY ("recognition_thumbnail_id") REFERENCES "public"."video_media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "video_snippets_screenshots" ADD CONSTRAINT "video_snippets_screenshots_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."video_snippets"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "video_snippets_detections_order_idx" ON "video_snippets_detections" USING btree ("_order");
  CREATE INDEX "video_snippets_detections_parent_id_idx" ON "video_snippets_detections" USING btree ("_parent_id");
  CREATE INDEX "video_snippets_detections_image_idx" ON "video_snippets_detections" USING btree ("image_id");
  CREATE INDEX "video_snippets_detections_matched_product_idx" ON "video_snippets_detections" USING btree ("matched_product_id");
  CREATE INDEX "video_snippets_screenshots_order_idx" ON "video_snippets_screenshots" USING btree ("_order");
  CREATE INDEX "video_snippets_screenshots_parent_id_idx" ON "video_snippets_screenshots" USING btree ("_parent_id");
  CREATE INDEX "video_snippets_screenshots_image_idx" ON "video_snippets_screenshots" USING btree ("image_id");
  CREATE INDEX "video_snippets_screenshots_thumbnail_idx" ON "video_snippets_screenshots" USING btree ("thumbnail_id");
  CREATE INDEX "video_snippets_screenshots_recognition_thumbnail_idx" ON "video_snippets_screenshots" USING btree ("recognition_thumbnail_id");
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "video_frames_id";`)
}
