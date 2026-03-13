import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Migration: Split single `media` collection into 4 specialized media collections.
 *
 * New tables:
 *   - product_media  — Product variant images (thumbnail 96x96, card 320x240, detail 780x780)
 *   - video_media    — Video files (MP4), thumbnails, screenshots (thumbnail 96x96, card 320x240, detail 780x780)
 *   - profile_media  — Channel avatars, creator images, ingredient images (avatar 128x128, thumbnail 96x96, card 320x240)
 *   - detection_media — Grounding DINO detection crops (no image sizes)
 *
 * FK remapping:
 *   product_variants_images.image_id          → product_media
 *   videos.thumbnail_id                       → video_media
 *   videos.video_file_id                      → video_media
 *   video_snippets.image_id                   → video_media
 *   video_snippets_screenshots.image_id       → video_media
 *   video_snippets_screenshots.thumbnail_id   → video_media
 *   video_snippets_screenshots.recognition_thumbnail_id → video_media
 *   ingredients.image_id                      → profile_media
 *   creators.image_id                         → profile_media
 *   channels.image_id                         → profile_media
 *   product_variants_recognition_images.image_id → detection_media
 *   video_snippets_detections.image_id        → detection_media
 *
 * NOTE: No data migration — the developer will re-initialize all data from scratch.
 * All existing media rows and FK references will be lost when the old table is dropped.
 */

export async function up({ db }: MigrateUpArgs): Promise<void> {
  // ── 1. Create product_media table ─────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE "product_media" (
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
      "sizes_card_filename" varchar,
      "sizes_detail_url" varchar,
      "sizes_detail_width" numeric,
      "sizes_detail_height" numeric,
      "sizes_detail_mime_type" varchar,
      "sizes_detail_filesize" numeric,
      "sizes_detail_filename" varchar
    );

    CREATE INDEX "product_media_updated_at_idx" ON "product_media" USING btree ("updated_at");
    CREATE INDEX "product_media_created_at_idx" ON "product_media" USING btree ("created_at");
    CREATE UNIQUE INDEX "product_media_filename_idx" ON "product_media" USING btree ("filename");
    CREATE INDEX "product_media_sizes_thumbnail_sizes_thumbnail_filename_idx" ON "product_media" USING btree ("sizes_thumbnail_filename");
    CREATE INDEX "product_media_sizes_card_sizes_card_filename_idx" ON "product_media" USING btree ("sizes_card_filename");
    CREATE INDEX "product_media_sizes_detail_sizes_detail_filename_idx" ON "product_media" USING btree ("sizes_detail_filename");
  `)

  // ── 2. Create video_media table ───────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE "video_media" (
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
      "sizes_card_filename" varchar,
      "sizes_detail_url" varchar,
      "sizes_detail_width" numeric,
      "sizes_detail_height" numeric,
      "sizes_detail_mime_type" varchar,
      "sizes_detail_filesize" numeric,
      "sizes_detail_filename" varchar
    );

    CREATE INDEX "video_media_updated_at_idx" ON "video_media" USING btree ("updated_at");
    CREATE INDEX "video_media_created_at_idx" ON "video_media" USING btree ("created_at");
    CREATE UNIQUE INDEX "video_media_filename_idx" ON "video_media" USING btree ("filename");
    CREATE INDEX "video_media_sizes_thumbnail_sizes_thumbnail_filename_idx" ON "video_media" USING btree ("sizes_thumbnail_filename");
    CREATE INDEX "video_media_sizes_card_sizes_card_filename_idx" ON "video_media" USING btree ("sizes_card_filename");
    CREATE INDEX "video_media_sizes_detail_sizes_detail_filename_idx" ON "video_media" USING btree ("sizes_detail_filename");
  `)

  // ── 3. Create profile_media table ─────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE "profile_media" (
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

    CREATE INDEX "profile_media_updated_at_idx" ON "profile_media" USING btree ("updated_at");
    CREATE INDEX "profile_media_created_at_idx" ON "profile_media" USING btree ("created_at");
    CREATE UNIQUE INDEX "profile_media_filename_idx" ON "profile_media" USING btree ("filename");
    CREATE INDEX "profile_media_sizes_avatar_sizes_avatar_filename_idx" ON "profile_media" USING btree ("sizes_avatar_filename");
    CREATE INDEX "profile_media_sizes_thumbnail_sizes_thumbnail_filename_idx" ON "profile_media" USING btree ("sizes_thumbnail_filename");
    CREATE INDEX "profile_media_sizes_card_sizes_card_filename_idx" ON "profile_media" USING btree ("sizes_card_filename");
  `)

  // ── 4. Create detection_media table (no image sizes) ──────────────────
  await db.execute(sql`
    CREATE TABLE "detection_media" (
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
      "focal_y" numeric
    );

    CREATE INDEX "detection_media_updated_at_idx" ON "detection_media" USING btree ("updated_at");
    CREATE INDEX "detection_media_created_at_idx" ON "detection_media" USING btree ("created_at");
    CREATE UNIQUE INDEX "detection_media_filename_idx" ON "detection_media" USING btree ("filename");
  `)

  // ── 5. Drop old FK constraints referencing media ──────────────────────
  await db.execute(sql`
    -- product_variants_images
    ALTER TABLE "product_variants_images" DROP CONSTRAINT IF EXISTS "product_variants_images_image_id_media_id_fk";

    -- product_variants_recognition_images
    ALTER TABLE "product_variants_recognition_images" DROP CONSTRAINT IF EXISTS "product_variants_recognition_images_image_id_media_id_fk";

    -- videos (thumbnail_id added in video_crawl_pipeline migration)
    ALTER TABLE "videos" DROP CONSTRAINT IF EXISTS "videos_thumbnail_id_media_id_fk";
    -- videos (video_file_id, renamed from image_id in video_crawl_pipeline migration)
    ALTER TABLE "videos" DROP CONSTRAINT IF EXISTS "videos_video_file_id_media_id_fk";

    -- video_snippets
    ALTER TABLE "video_snippets" DROP CONSTRAINT IF EXISTS "video_snippets_image_id_media_id_fk";

    -- video_snippets_screenshots
    ALTER TABLE "video_snippets_screenshots" DROP CONSTRAINT IF EXISTS "video_snippets_screenshots_image_id_media_id_fk";
    ALTER TABLE "video_snippets_screenshots" DROP CONSTRAINT IF EXISTS "video_snippets_screenshots_thumbnail_id_media_id_fk";
    ALTER TABLE "video_snippets_screenshots" DROP CONSTRAINT IF EXISTS "video_snippets_screenshots_recognition_thumbnail_id_media_id_fk";

    -- video_snippets_detections (created in migration 20260313_085035)
    ALTER TABLE "video_snippets_detections" DROP CONSTRAINT IF EXISTS "video_snippets_detections_image_id_media_id_fk";

    -- ingredients
    ALTER TABLE "ingredients" DROP CONSTRAINT IF EXISTS "ingredients_image_id_media_id_fk";

    -- creators
    ALTER TABLE "creators" DROP CONSTRAINT IF EXISTS "creators_image_id_media_id_fk";

    -- channels
    ALTER TABLE "channels" DROP CONSTRAINT IF EXISTS "channels_image_id_media_id_fk";

    -- payload_locked_documents_rels
    ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_media_fk";
  `)

  // ── 6. Nullify all FK columns (data will be re-crawled) ───────────────
  await db.execute(sql`
    UPDATE "product_variants_images" SET "image_id" = NULL WHERE "image_id" IS NOT NULL;
    UPDATE "product_variants_recognition_images" SET "image_id" = NULL WHERE "image_id" IS NOT NULL;
    UPDATE "videos" SET "thumbnail_id" = NULL, "video_file_id" = NULL WHERE "thumbnail_id" IS NOT NULL OR "video_file_id" IS NOT NULL;
    UPDATE "video_snippets" SET "image_id" = NULL WHERE "image_id" IS NOT NULL;
    UPDATE "video_snippets_screenshots" SET "image_id" = NULL, "thumbnail_id" = NULL, "recognition_thumbnail_id" = NULL
      WHERE "image_id" IS NOT NULL OR "thumbnail_id" IS NOT NULL OR "recognition_thumbnail_id" IS NOT NULL;
    UPDATE "video_snippets_detections" SET "image_id" = NULL WHERE "image_id" IS NOT NULL;
    UPDATE "ingredients" SET "image_id" = NULL WHERE "image_id" IS NOT NULL;
    UPDATE "creators" SET "image_id" = NULL WHERE "image_id" IS NOT NULL;
    UPDATE "channels" SET "image_id" = NULL WHERE "image_id" IS NOT NULL;
  `)

  // ── 7. Add new FK constraints pointing to the correct media tables ────
  await db.execute(sql`
    -- product_variants_images → product_media
    ALTER TABLE "product_variants_images"
      ADD CONSTRAINT "product_variants_images_image_id_product_media_id_fk"
        FOREIGN KEY ("image_id") REFERENCES "product_media"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

    -- product_variants_recognition_images → detection_media
    ALTER TABLE "product_variants_recognition_images"
      ADD CONSTRAINT "product_variants_recognition_images_image_id_detection_media_id_fk"
        FOREIGN KEY ("image_id") REFERENCES "detection_media"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

    -- videos.thumbnail_id → video_media
    ALTER TABLE "videos"
      ADD CONSTRAINT "videos_thumbnail_id_video_media_id_fk"
        FOREIGN KEY ("thumbnail_id") REFERENCES "video_media"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

    -- videos.video_file_id → video_media
    ALTER TABLE "videos"
      ADD CONSTRAINT "videos_video_file_id_video_media_id_fk"
        FOREIGN KEY ("video_file_id") REFERENCES "video_media"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

    -- video_snippets.image_id → video_media
    ALTER TABLE "video_snippets"
      ADD CONSTRAINT "video_snippets_image_id_video_media_id_fk"
        FOREIGN KEY ("image_id") REFERENCES "video_media"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

    -- video_snippets_screenshots.image_id → video_media
    ALTER TABLE "video_snippets_screenshots"
      ADD CONSTRAINT "video_snippets_screenshots_image_id_video_media_id_fk"
        FOREIGN KEY ("image_id") REFERENCES "video_media"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

    -- video_snippets_screenshots.thumbnail_id → video_media
    ALTER TABLE "video_snippets_screenshots"
      ADD CONSTRAINT "video_snippets_screenshots_thumbnail_id_video_media_id_fk"
        FOREIGN KEY ("thumbnail_id") REFERENCES "video_media"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

    -- video_snippets_screenshots.recognition_thumbnail_id → video_media
    ALTER TABLE "video_snippets_screenshots"
      ADD CONSTRAINT "video_snippets_screenshots_recognition_thumbnail_id_video_media_id_fk"
        FOREIGN KEY ("recognition_thumbnail_id") REFERENCES "video_media"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

    -- video_snippets_detections.image_id → detection_media
    ALTER TABLE "video_snippets_detections"
      ADD CONSTRAINT "video_snippets_detections_image_id_detection_media_id_fk"
        FOREIGN KEY ("image_id") REFERENCES "detection_media"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

    -- ingredients.image_id → profile_media
    ALTER TABLE "ingredients"
      ADD CONSTRAINT "ingredients_image_id_profile_media_id_fk"
        FOREIGN KEY ("image_id") REFERENCES "profile_media"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

    -- creators.image_id → profile_media
    ALTER TABLE "creators"
      ADD CONSTRAINT "creators_image_id_profile_media_id_fk"
        FOREIGN KEY ("image_id") REFERENCES "profile_media"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

    -- channels.image_id → profile_media
    ALTER TABLE "channels"
      ADD CONSTRAINT "channels_image_id_profile_media_id_fk"
        FOREIGN KEY ("image_id") REFERENCES "profile_media"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  `)

  // ── 8. Update payload_locked_documents_rels ───────────────────────────
  // Remove old media_id column, add 4 new columns for the new media collections
  await db.execute(sql`
    DROP INDEX IF EXISTS "payload_locked_documents_rels_media_id_idx";
    ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "media_id";

    ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "product_media_id" integer;
    ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "video_media_id" integer;
    ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "profile_media_id" integer;
    ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "detection_media_id" integer;

    CREATE INDEX "payload_locked_documents_rels_product_media_id_idx"
      ON "payload_locked_documents_rels" USING btree ("product_media_id");
    CREATE INDEX "payload_locked_documents_rels_video_media_id_idx"
      ON "payload_locked_documents_rels" USING btree ("video_media_id");
    CREATE INDEX "payload_locked_documents_rels_profile_media_id_idx"
      ON "payload_locked_documents_rels" USING btree ("profile_media_id");
    CREATE INDEX "payload_locked_documents_rels_detection_media_id_idx"
      ON "payload_locked_documents_rels" USING btree ("detection_media_id");

    ALTER TABLE "payload_locked_documents_rels"
      ADD CONSTRAINT "payload_locked_documents_rels_product_media_fk"
        FOREIGN KEY ("product_media_id") REFERENCES "product_media"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
    ALTER TABLE "payload_locked_documents_rels"
      ADD CONSTRAINT "payload_locked_documents_rels_video_media_fk"
        FOREIGN KEY ("video_media_id") REFERENCES "video_media"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
    ALTER TABLE "payload_locked_documents_rels"
      ADD CONSTRAINT "payload_locked_documents_rels_profile_media_fk"
        FOREIGN KEY ("profile_media_id") REFERENCES "profile_media"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
    ALTER TABLE "payload_locked_documents_rels"
      ADD CONSTRAINT "payload_locked_documents_rels_detection_media_fk"
        FOREIGN KEY ("detection_media_id") REFERENCES "detection_media"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  `)

  // ── 9. Drop the old media table ───────────────────────────────────────
  await db.execute(sql`
    DROP TABLE "media" CASCADE;
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // ── 1. Recreate the old media table ───────────────────────────────────
  await db.execute(sql`
    CREATE TABLE "media" (
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
      "sizes_card_filename" varchar,
      "sizes_detail_url" varchar,
      "sizes_detail_width" numeric,
      "sizes_detail_height" numeric,
      "sizes_detail_mime_type" varchar,
      "sizes_detail_filesize" numeric,
      "sizes_detail_filename" varchar
    );

    CREATE INDEX "media_updated_at_idx" ON "media" USING btree ("updated_at");
    CREATE INDEX "media_created_at_idx" ON "media" USING btree ("created_at");
    CREATE UNIQUE INDEX "media_filename_idx" ON "media" USING btree ("filename");
    CREATE INDEX "media_sizes_thumbnail_sizes_thumbnail_filename_idx" ON "media" USING btree ("sizes_thumbnail_filename");
    CREATE INDEX "media_sizes_card_sizes_card_filename_idx" ON "media" USING btree ("sizes_card_filename");
    CREATE INDEX "media_sizes_detail_sizes_detail_filename_idx" ON "media" USING btree ("sizes_detail_filename");
  `)

  // ── 2. Drop new FK constraints ────────────────────────────────────────
  await db.execute(sql`
    ALTER TABLE "product_variants_images" DROP CONSTRAINT IF EXISTS "product_variants_images_image_id_product_media_id_fk";
    ALTER TABLE "product_variants_recognition_images" DROP CONSTRAINT IF EXISTS "product_variants_recognition_images_image_id_detection_media_id_fk";
    ALTER TABLE "videos" DROP CONSTRAINT IF EXISTS "videos_thumbnail_id_video_media_id_fk";
    ALTER TABLE "videos" DROP CONSTRAINT IF EXISTS "videos_video_file_id_video_media_id_fk";
    ALTER TABLE "video_snippets" DROP CONSTRAINT IF EXISTS "video_snippets_image_id_video_media_id_fk";
    ALTER TABLE "video_snippets_screenshots" DROP CONSTRAINT IF EXISTS "video_snippets_screenshots_image_id_video_media_id_fk";
    ALTER TABLE "video_snippets_screenshots" DROP CONSTRAINT IF EXISTS "video_snippets_screenshots_thumbnail_id_video_media_id_fk";
    ALTER TABLE "video_snippets_screenshots" DROP CONSTRAINT IF EXISTS "video_snippets_screenshots_recognition_thumbnail_id_video_media_id_fk";
    ALTER TABLE "video_snippets_detections" DROP CONSTRAINT IF EXISTS "video_snippets_detections_image_id_detection_media_id_fk";
    ALTER TABLE "ingredients" DROP CONSTRAINT IF EXISTS "ingredients_image_id_profile_media_id_fk";
    ALTER TABLE "creators" DROP CONSTRAINT IF EXISTS "creators_image_id_profile_media_id_fk";
    ALTER TABLE "channels" DROP CONSTRAINT IF EXISTS "channels_image_id_profile_media_id_fk";
  `)

  // ── 3. Re-add old FK constraints pointing back to media ───────────────
  await db.execute(sql`
    ALTER TABLE "product_variants_images"
      ADD CONSTRAINT "product_variants_images_image_id_media_id_fk"
        FOREIGN KEY ("image_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

    ALTER TABLE "product_variants_recognition_images"
      ADD CONSTRAINT "product_variants_recognition_images_image_id_media_id_fk"
        FOREIGN KEY ("image_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

    ALTER TABLE "videos"
      ADD CONSTRAINT "videos_thumbnail_id_media_id_fk"
        FOREIGN KEY ("thumbnail_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

    ALTER TABLE "videos"
      ADD CONSTRAINT "videos_video_file_id_media_id_fk"
        FOREIGN KEY ("video_file_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

    ALTER TABLE "video_snippets"
      ADD CONSTRAINT "video_snippets_image_id_media_id_fk"
        FOREIGN KEY ("image_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

    ALTER TABLE "video_snippets_screenshots"
      ADD CONSTRAINT "video_snippets_screenshots_image_id_media_id_fk"
        FOREIGN KEY ("image_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

    ALTER TABLE "video_snippets_screenshots"
      ADD CONSTRAINT "video_snippets_screenshots_thumbnail_id_media_id_fk"
        FOREIGN KEY ("thumbnail_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

    ALTER TABLE "video_snippets_screenshots"
      ADD CONSTRAINT "video_snippets_screenshots_recognition_thumbnail_id_media_id_fk"
        FOREIGN KEY ("recognition_thumbnail_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

    ALTER TABLE "video_snippets_detections"
      ADD CONSTRAINT "video_snippets_detections_image_id_media_id_fk"
        FOREIGN KEY ("image_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

    ALTER TABLE "ingredients"
      ADD CONSTRAINT "ingredients_image_id_media_id_fk"
        FOREIGN KEY ("image_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

    ALTER TABLE "creators"
      ADD CONSTRAINT "creators_image_id_media_id_fk"
        FOREIGN KEY ("image_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

    ALTER TABLE "channels"
      ADD CONSTRAINT "channels_image_id_media_id_fk"
        FOREIGN KEY ("image_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  `)

  // ── 4. Restore payload_locked_documents_rels ──────────────────────────
  await db.execute(sql`
    ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_product_media_fk";
    ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_video_media_fk";
    ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_profile_media_fk";
    ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_detection_media_fk";

    DROP INDEX IF EXISTS "payload_locked_documents_rels_product_media_id_idx";
    DROP INDEX IF EXISTS "payload_locked_documents_rels_video_media_id_idx";
    DROP INDEX IF EXISTS "payload_locked_documents_rels_profile_media_id_idx";
    DROP INDEX IF EXISTS "payload_locked_documents_rels_detection_media_id_idx";

    ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "product_media_id";
    ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "video_media_id";
    ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "profile_media_id";
    ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "detection_media_id";

    ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "media_id" integer;
    CREATE INDEX "payload_locked_documents_rels_media_id_idx"
      ON "payload_locked_documents_rels" USING btree ("media_id");
    ALTER TABLE "payload_locked_documents_rels"
      ADD CONSTRAINT "payload_locked_documents_rels_media_fk"
        FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  `)

  // ── 5. Drop the new media tables ──────────────────────────────────────
  await db.execute(sql`
    DROP TABLE IF EXISTS "product_media" CASCADE;
    DROP TABLE IF EXISTS "video_media" CASCADE;
    DROP TABLE IF EXISTS "profile_media" CASCADE;
    DROP TABLE IF EXISTS "detection_media" CASCADE;
  `)
}
