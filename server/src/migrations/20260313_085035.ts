import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
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
  
  ALTER TABLE "video_processings" ADD COLUMN "stage_screenshot_detection" boolean DEFAULT true;
  ALTER TABLE "video_processings" ADD COLUMN "stage_screenshot_search" boolean DEFAULT true;
  ALTER TABLE "video_snippets_detections" ADD CONSTRAINT "video_snippets_detections_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "video_snippets_detections" ADD CONSTRAINT "video_snippets_detections_matched_product_id_products_id_fk" FOREIGN KEY ("matched_product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "video_snippets_detections" ADD CONSTRAINT "video_snippets_detections_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."video_snippets"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "video_snippets_detections_order_idx" ON "video_snippets_detections" USING btree ("_order");
  CREATE INDEX "video_snippets_detections_parent_id_idx" ON "video_snippets_detections" USING btree ("_parent_id");
  CREATE INDEX "video_snippets_detections_image_idx" ON "video_snippets_detections" USING btree ("image_id");
  CREATE INDEX "video_snippets_detections_matched_product_idx" ON "video_snippets_detections" USING btree ("matched_product_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "video_snippets_detections" CASCADE;
  ALTER TABLE "video_processings" DROP COLUMN "stage_screenshot_detection";
  ALTER TABLE "video_processings" DROP COLUMN "stage_screenshot_search";`)
}
