import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "product_media" ADD COLUMN "prefix" varchar DEFAULT 'dev/product-media';
  ALTER TABLE "video_media" ADD COLUMN "prefix" varchar DEFAULT 'dev/video-media';
  ALTER TABLE "profile_media" ADD COLUMN "prefix" varchar DEFAULT 'dev/profile-media';
  ALTER TABLE "detection_media" ADD COLUMN "prefix" varchar DEFAULT 'dev/detection-media';
  ALTER TABLE "debug_screenshots" ADD COLUMN "prefix" varchar DEFAULT 'dev/debug-screenshots';`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "product_media" DROP COLUMN "prefix";
  ALTER TABLE "video_media" DROP COLUMN "prefix";
  ALTER TABLE "profile_media" DROP COLUMN "prefix";
  ALTER TABLE "detection_media" DROP COLUMN "prefix";
  ALTER TABLE "debug_screenshots" DROP COLUMN "prefix";`)
}
