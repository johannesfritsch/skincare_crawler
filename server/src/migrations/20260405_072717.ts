import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "brand_media" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"alt" varchar NOT NULL,
  	"prefix" varchar DEFAULT 'dev/brand-media',
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
  	"sizes_avatar_url" varchar,
  	"sizes_avatar_width" numeric,
  	"sizes_avatar_height" numeric,
  	"sizes_avatar_mime_type" varchar,
  	"sizes_avatar_filesize" numeric,
  	"sizes_avatar_filename" varchar,
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
  	"sizes_card_filename" varchar
  );
  
  ALTER TABLE "brands" DROP CONSTRAINT "brands_image_id_profile_media_id_fk";
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "brand_media_id" integer;
  CREATE INDEX "brand_media_updated_at_idx" ON "brand_media" USING btree ("updated_at");
  CREATE INDEX "brand_media_created_at_idx" ON "brand_media" USING btree ("created_at");
  CREATE UNIQUE INDEX "brand_media_filename_idx" ON "brand_media" USING btree ("filename");
  CREATE INDEX "brand_media_sizes_avatar_sizes_avatar_filename_idx" ON "brand_media" USING btree ("sizes_avatar_filename");
  CREATE INDEX "brand_media_sizes_thumbnail_sizes_thumbnail_filename_idx" ON "brand_media" USING btree ("sizes_thumbnail_filename");
  CREATE INDEX "brand_media_sizes_card_sizes_card_filename_idx" ON "brand_media" USING btree ("sizes_card_filename");
  ALTER TABLE "brands" ADD CONSTRAINT "brands_image_id_brand_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."brand_media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_brand_media_fk" FOREIGN KEY ("brand_media_id") REFERENCES "public"."brand_media"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_brand_media_id_idx" ON "payload_locked_documents_rels" USING btree ("brand_media_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "brand_media" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "brand_media" CASCADE;
  ALTER TABLE "brands" DROP CONSTRAINT "brands_image_id_brand_media_id_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_brand_media_fk";
  
  DROP INDEX "payload_locked_documents_rels_brand_media_id_idx";
  ALTER TABLE "brands" ADD CONSTRAINT "brands_image_id_profile_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."profile_media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "brand_media_id";`)
}
