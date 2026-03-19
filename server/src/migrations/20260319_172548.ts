import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "video_crawls" ADD COLUMN "stage_metadata" boolean DEFAULT true;
  ALTER TABLE "video_crawls" ADD COLUMN "stage_download" boolean DEFAULT true;
  ALTER TABLE "video_crawls" ADD COLUMN "stage_audio" boolean DEFAULT true;
  ALTER TABLE "video_crawls" ADD COLUMN "crawl_progress" jsonb;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "video_crawls" DROP COLUMN "stage_metadata";
  ALTER TABLE "video_crawls" DROP COLUMN "stage_download";
  ALTER TABLE "video_crawls" DROP COLUMN "stage_audio";
  ALTER TABLE "video_crawls" DROP COLUMN "crawl_progress";`)
}
