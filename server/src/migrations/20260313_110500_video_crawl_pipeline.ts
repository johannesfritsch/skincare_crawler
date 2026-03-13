import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Migration: 3-step video pipeline refactor
 *
 * 1. Create video_crawls table (new collection)
 * 2. Videos: add status (discovered/crawled/processed), rename image_id → video_file_id, add thumbnail_id
 * 3. Video discoveries: add video_urls column, drop created/existing columns
 * 4. Video processings: add from_crawl to type enum, add crawl_id FK, drop stage_download
 * 5. Workers: add video-crawl capability to enum
 * 6. events_rels + payload_locked_documents_rels: add video_crawls_id FK
 *
 * NOTE: The rename of image_id → video_file_id is done explicitly (not drop+add) to preserve data.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  // ── 1. Create enums for video_crawls ──────────────────────────────────
  await db.execute(sql`
    CREATE TYPE "enum_video_crawls_status" AS ENUM('pending', 'in_progress', 'completed', 'failed');
    CREATE TYPE "enum_video_crawls_type" AS ENUM('all', 'selected_urls', 'from_discovery');
    CREATE TYPE "enum_video_crawls_scope" AS ENUM('uncrawled_only', 'recrawl');
  `)

  // ── 2. Create video_crawls table ──────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "video_crawls" (
      "id" serial PRIMARY KEY NOT NULL,
      "status" "enum_video_crawls_status" DEFAULT 'pending',
      "claimed_at" timestamp(3) with time zone,
      "claimed_by_id" integer,
      "retry_count" numeric DEFAULT 0,
      "max_retries" numeric DEFAULT 3,
      "failed_at" timestamp(3) with time zone,
      "failure_reason" varchar,
      "items_per_tick" numeric DEFAULT 5,
      "type" "enum_video_crawls_type" NOT NULL DEFAULT 'all',
      "scope" "enum_video_crawls_scope" DEFAULT 'uncrawled_only',
      "urls" varchar,
      "discovery_id" integer,
      "total" numeric,
      "crawled" numeric DEFAULT 0,
      "errors" numeric DEFAULT 0,
      "started_at" timestamp(3) with time zone,
      "completed_at" timestamp(3) with time zone,
      "crawled_video_urls" varchar,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
    );
  `)

  // ── 3. Indexes and FKs for video_crawls ───────────────────────────────
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "video_crawls_status_idx" ON "video_crawls" USING btree ("status");
    CREATE INDEX IF NOT EXISTS "video_crawls_claimed_by_idx" ON "video_crawls" USING btree ("claimed_by_id");
    CREATE INDEX IF NOT EXISTS "video_crawls_discovery_idx" ON "video_crawls" USING btree ("discovery_id");
    CREATE INDEX IF NOT EXISTS "video_crawls_created_at_idx" ON "video_crawls" USING btree ("created_at");
    CREATE INDEX IF NOT EXISTS "video_crawls_updated_at_idx" ON "video_crawls" USING btree ("updated_at");

    ALTER TABLE "video_crawls"
      ADD CONSTRAINT "video_crawls_claimed_by_id_workers_id_fk"
        FOREIGN KEY ("claimed_by_id") REFERENCES "workers"("id") ON DELETE SET NULL;
    ALTER TABLE "video_crawls"
      ADD CONSTRAINT "video_crawls_discovery_id_video_discoveries_id_fk"
        FOREIGN KEY ("discovery_id") REFERENCES "video_discoveries"("id") ON DELETE SET NULL;
  `)

  // ── 4. Videos: add status, rename image_id → video_file_id, add thumbnail_id ─
  await db.execute(sql`
    CREATE TYPE "enum_videos_status" AS ENUM('discovered', 'crawled', 'processed');

    ALTER TABLE "videos" ADD COLUMN "status" "enum_videos_status" DEFAULT 'discovered';
    CREATE INDEX IF NOT EXISTS "videos_status_idx" ON "videos" USING btree ("status");

    -- Rename image_id → video_file_id (preserves existing data)
    ALTER TABLE "videos" DROP CONSTRAINT IF EXISTS "videos_image_id_media_id_fk";
    DROP INDEX IF EXISTS "videos_image_idx";
    ALTER TABLE "videos" RENAME COLUMN "image_id" TO "video_file_id";
    CREATE INDEX IF NOT EXISTS "videos_video_file_idx" ON "videos" USING btree ("video_file_id");
    ALTER TABLE "videos"
      ADD CONSTRAINT "videos_video_file_id_media_id_fk"
        FOREIGN KEY ("video_file_id") REFERENCES "media"("id") ON DELETE SET NULL;

    -- Add thumbnail_id
    ALTER TABLE "videos" ADD COLUMN "thumbnail_id" integer;
    CREATE INDEX IF NOT EXISTS "videos_thumbnail_idx" ON "videos" USING btree ("thumbnail_id");
    ALTER TABLE "videos"
      ADD CONSTRAINT "videos_thumbnail_id_media_id_fk"
        FOREIGN KEY ("thumbnail_id") REFERENCES "media"("id") ON DELETE SET NULL;

    -- Mark existing videos that have a video file as 'crawled'
    UPDATE "videos" SET "status" = 'crawled' WHERE "video_file_id" IS NOT NULL;
  `)

  // ── 5. Video discoveries: add video_urls, drop created/existing ────────
  await db.execute(sql`
    ALTER TABLE "video_discoveries" ADD COLUMN "video_urls" varchar;
    ALTER TABLE "video_discoveries" DROP COLUMN IF EXISTS "created";
    ALTER TABLE "video_discoveries" DROP COLUMN IF EXISTS "existing";
  `)

  // ── 6. Video processings: add from_crawl type, add crawl_id, drop stage_download ─
  await db.execute(sql`
    ALTER TYPE "enum_video_processings_type" ADD VALUE IF NOT EXISTS 'from_crawl';

    ALTER TABLE "video_processings" ADD COLUMN "crawl_id" integer;
    CREATE INDEX IF NOT EXISTS "video_processings_crawl_idx" ON "video_processings" USING btree ("crawl_id");
    ALTER TABLE "video_processings"
      ADD CONSTRAINT "video_processings_crawl_id_video_crawls_id_fk"
        FOREIGN KEY ("crawl_id") REFERENCES "video_crawls"("id") ON DELETE SET NULL;

    ALTER TABLE "video_processings" DROP COLUMN IF EXISTS "stage_download";
  `)

  // ── 7. Workers: add video-crawl capability to enum ─────────────────────
  await db.execute(sql`
    ALTER TYPE "enum_workers_capabilities" ADD VALUE IF NOT EXISTS 'video-crawl';
  `)

  // ── 8. events_rels: add video_crawls_id FK ────────────────────────────
  await db.execute(sql`
    ALTER TABLE "events_rels" ADD COLUMN "video_crawls_id" integer;
    CREATE INDEX IF NOT EXISTS "events_rels_video_crawls_id_idx" ON "events_rels" USING btree ("video_crawls_id");
    ALTER TABLE "events_rels"
      ADD CONSTRAINT "events_rels_video_crawls_fk"
        FOREIGN KEY ("video_crawls_id") REFERENCES "video_crawls"("id") ON DELETE CASCADE;
  `)

  // ── 9. payload_locked_documents_rels: add video_crawls_id FK ──────────
  await db.execute(sql`
    ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "video_crawls_id" integer;
    CREATE INDEX IF NOT EXISTS "payload_locked_documents_rels_video_crawls_id_idx"
      ON "payload_locked_documents_rels" USING btree ("video_crawls_id");
    ALTER TABLE "payload_locked_documents_rels"
      ADD CONSTRAINT "payload_locked_documents_rels_video_crawls_fk"
        FOREIGN KEY ("video_crawls_id") REFERENCES "video_crawls"("id") ON DELETE CASCADE;
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // ── Reverse: payload_locked_documents_rels ─────────────────────────────
  await db.execute(sql`
    ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_video_crawls_fk";
    DROP INDEX IF EXISTS "payload_locked_documents_rels_video_crawls_id_idx";
    ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "video_crawls_id";
  `)

  // ── Reverse: events_rels ──────────────────────────────────────────────
  await db.execute(sql`
    ALTER TABLE "events_rels" DROP CONSTRAINT IF EXISTS "events_rels_video_crawls_fk";
    DROP INDEX IF EXISTS "events_rels_video_crawls_id_idx";
    ALTER TABLE "events_rels" DROP COLUMN IF EXISTS "video_crawls_id";
  `)

  // ── Reverse: video_processings ────────────────────────────────────────
  await db.execute(sql`
    ALTER TABLE "video_processings" DROP CONSTRAINT IF EXISTS "video_processings_crawl_id_video_crawls_id_fk";
    DROP INDEX IF EXISTS "video_processings_crawl_idx";
    ALTER TABLE "video_processings" DROP COLUMN IF EXISTS "crawl_id";
    ALTER TABLE "video_processings" ADD COLUMN "stage_download" boolean DEFAULT true;
    -- Note: Cannot remove 'from_crawl' from enum_video_processings_type easily in Postgres
  `)

  // ── Reverse: video_discoveries ────────────────────────────────────────
  await db.execute(sql`
    ALTER TABLE "video_discoveries" ADD COLUMN "created" numeric DEFAULT 0;
    ALTER TABLE "video_discoveries" ADD COLUMN "existing" numeric DEFAULT 0;
    ALTER TABLE "video_discoveries" DROP COLUMN IF EXISTS "video_urls";
  `)

  // ── Reverse: videos ───────────────────────────────────────────────────
  await db.execute(sql`
    ALTER TABLE "videos" DROP CONSTRAINT IF EXISTS "videos_thumbnail_id_media_id_fk";
    DROP INDEX IF EXISTS "videos_thumbnail_idx";
    ALTER TABLE "videos" DROP COLUMN IF EXISTS "thumbnail_id";

    ALTER TABLE "videos" DROP CONSTRAINT IF EXISTS "videos_video_file_id_media_id_fk";
    DROP INDEX IF EXISTS "videos_video_file_idx";
    ALTER TABLE "videos" RENAME COLUMN "video_file_id" TO "image_id";
    CREATE INDEX IF NOT EXISTS "videos_image_idx" ON "videos" USING btree ("image_id");
    ALTER TABLE "videos"
      ADD CONSTRAINT "videos_image_id_media_id_fk"
        FOREIGN KEY ("image_id") REFERENCES "media"("id") ON DELETE SET NULL;

    DROP INDEX IF EXISTS "videos_status_idx";
    ALTER TABLE "videos" DROP COLUMN IF EXISTS "status";
    DROP TYPE IF EXISTS "enum_videos_status";
  `)

  // ── Reverse: video_crawls ─────────────────────────────────────────────
  await db.execute(sql`
    DROP TABLE IF EXISTS "video_crawls";
    DROP TYPE IF EXISTS "enum_video_crawls_status";
    DROP TYPE IF EXISTS "enum_video_crawls_type";
    DROP TYPE IF EXISTS "enum_video_crawls_scope";
  `)
}
