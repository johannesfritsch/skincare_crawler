import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "debug_screenshots" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"alt" varchar NOT NULL,
  	"step" varchar,
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
  	"sizes_thumbnail_filename" varchar
  );
  
  CREATE TABLE "debug_screenshots_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"product_crawls_id" integer,
  	"product_discoveries_id" integer,
  	"product_searches_id" integer
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "debug_screenshots_id" integer;
  ALTER TABLE "debug_screenshots_rels" ADD CONSTRAINT "debug_screenshots_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."debug_screenshots"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "debug_screenshots_rels" ADD CONSTRAINT "debug_screenshots_rels_product_crawls_fk" FOREIGN KEY ("product_crawls_id") REFERENCES "public"."product_crawls"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "debug_screenshots_rels" ADD CONSTRAINT "debug_screenshots_rels_product_discoveries_fk" FOREIGN KEY ("product_discoveries_id") REFERENCES "public"."product_discoveries"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "debug_screenshots_rels" ADD CONSTRAINT "debug_screenshots_rels_product_searches_fk" FOREIGN KEY ("product_searches_id") REFERENCES "public"."product_searches"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "debug_screenshots_updated_at_idx" ON "debug_screenshots" USING btree ("updated_at");
  CREATE INDEX "debug_screenshots_created_at_idx" ON "debug_screenshots" USING btree ("created_at");
  CREATE UNIQUE INDEX "debug_screenshots_filename_idx" ON "debug_screenshots" USING btree ("filename");
  CREATE INDEX "debug_screenshots_sizes_thumbnail_sizes_thumbnail_filena_idx" ON "debug_screenshots" USING btree ("sizes_thumbnail_filename");
  CREATE INDEX "debug_screenshots_rels_order_idx" ON "debug_screenshots_rels" USING btree ("order");
  CREATE INDEX "debug_screenshots_rels_parent_idx" ON "debug_screenshots_rels" USING btree ("parent_id");
  CREATE INDEX "debug_screenshots_rels_path_idx" ON "debug_screenshots_rels" USING btree ("path");
  CREATE INDEX "debug_screenshots_rels_product_crawls_id_idx" ON "debug_screenshots_rels" USING btree ("product_crawls_id");
  CREATE INDEX "debug_screenshots_rels_product_discoveries_id_idx" ON "debug_screenshots_rels" USING btree ("product_discoveries_id");
  CREATE INDEX "debug_screenshots_rels_product_searches_id_idx" ON "debug_screenshots_rels" USING btree ("product_searches_id");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_debug_screenshots_fk" FOREIGN KEY ("debug_screenshots_id") REFERENCES "public"."debug_screenshots"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_debug_screenshots_id_idx" ON "payload_locked_documents_rels" USING btree ("debug_screenshots_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "debug_screenshots" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "debug_screenshots_rels" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "debug_screenshots" CASCADE;
  DROP TABLE "debug_screenshots_rels" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_debug_screenshots_fk";
  
  DROP INDEX "payload_locked_documents_rels_debug_screenshots_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "debug_screenshots_id";`)
}
