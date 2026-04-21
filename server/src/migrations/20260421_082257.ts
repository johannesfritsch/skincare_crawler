import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "galleries" ADD COLUMN "image_source_urls" jsonb;
  ALTER TABLE "gallery_crawls" ADD COLUMN "stage_metadata" boolean DEFAULT true;
  ALTER TABLE "gallery_crawls" ADD COLUMN "stage_download" boolean DEFAULT true;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "galleries" DROP COLUMN "image_source_urls";
  ALTER TABLE "gallery_crawls" DROP COLUMN "stage_metadata";
  ALTER TABLE "gallery_crawls" DROP COLUMN "stage_download";`)
}
