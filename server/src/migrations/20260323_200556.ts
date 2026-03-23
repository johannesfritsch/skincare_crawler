import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  // Step 1: Create the new table
  await db.execute(sql`
   CREATE TABLE "ingredient_media" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"alt" varchar NOT NULL,
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
  	"sizes_card_filename" varchar
  );`)

  // Step 2: Copy referenced profile_media rows into ingredient_media (preserving IDs)
  await db.execute(sql`
  INSERT INTO "ingredient_media" (
    "id", "alt", "updated_at", "created_at", "url", "thumbnail_u_r_l", "filename",
    "mime_type", "filesize", "width", "height", "focal_x", "focal_y",
    "sizes_thumbnail_url", "sizes_thumbnail_width", "sizes_thumbnail_height",
    "sizes_thumbnail_mime_type", "sizes_thumbnail_filesize", "sizes_thumbnail_filename",
    "sizes_card_url", "sizes_card_width", "sizes_card_height",
    "sizes_card_mime_type", "sizes_card_filesize", "sizes_card_filename"
  )
  SELECT
    pm."id", pm."alt", pm."updated_at", pm."created_at", pm."url", pm."thumbnail_u_r_l", pm."filename",
    pm."mime_type", pm."filesize", pm."width", pm."height", pm."focal_x", pm."focal_y",
    pm."sizes_thumbnail_url", pm."sizes_thumbnail_width", pm."sizes_thumbnail_height",
    pm."sizes_thumbnail_mime_type", pm."sizes_thumbnail_filesize", pm."sizes_thumbnail_filename",
    pm."sizes_card_url", pm."sizes_card_width", pm."sizes_card_height",
    pm."sizes_card_mime_type", pm."sizes_card_filesize", pm."sizes_card_filename"
  FROM "profile_media" pm
  INNER JOIN "ingredients" i ON i."image_id" = pm."id";`)

  // Step 3: Advance the ingredient_media sequence past the copied IDs
  await db.execute(sql`
  SELECT setval('ingredient_media_id_seq', COALESCE((SELECT MAX(id) FROM ingredient_media), 0) + 1, false);`)

  // Step 4: Swap FK, add indexes, add locked_documents column
  await db.execute(sql`
  ALTER TABLE "ingredients" DROP CONSTRAINT "ingredients_image_id_profile_media_id_fk";

  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "ingredient_media_id" integer;
  CREATE INDEX "ingredient_media_updated_at_idx" ON "ingredient_media" USING btree ("updated_at");
  CREATE INDEX "ingredient_media_created_at_idx" ON "ingredient_media" USING btree ("created_at");
  CREATE UNIQUE INDEX "ingredient_media_filename_idx" ON "ingredient_media" USING btree ("filename");
  CREATE INDEX "ingredient_media_sizes_thumbnail_sizes_thumbnail_filenam_idx" ON "ingredient_media" USING btree ("sizes_thumbnail_filename");
  CREATE INDEX "ingredient_media_sizes_card_sizes_card_filename_idx" ON "ingredient_media" USING btree ("sizes_card_filename");
  ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_image_id_ingredient_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."ingredient_media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_ingredient_media_fk" FOREIGN KEY ("ingredient_media_id") REFERENCES "public"."ingredient_media"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_ingredient_media_id_idx" ON "payload_locked_documents_rels" USING btree ("ingredient_media_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "ingredient_media" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "ingredient_media" CASCADE;
  ALTER TABLE "ingredients" DROP CONSTRAINT "ingredients_image_id_ingredient_media_id_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_ingredient_media_fk";
  
  DROP INDEX "payload_locked_documents_rels_ingredient_media_id_idx";
  ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_image_id_profile_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."profile_media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "ingredient_media_id";`)
}
