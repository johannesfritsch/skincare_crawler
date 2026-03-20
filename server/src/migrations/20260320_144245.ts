import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "video_frames" ADD COLUMN "frame_index" numeric;
  ALTER TABLE "video_frames" ADD COLUMN "video_time" numeric;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "video_frames" DROP COLUMN "frame_index";
  ALTER TABLE "video_frames" DROP COLUMN "video_time";`)
}
