import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "videos" ADD COLUMN "transcript" varchar;
  ALTER TABLE "video_scenes" ADD COLUMN "pre_transcript" varchar;
  ALTER TABLE "video_scenes" ADD COLUMN "post_transcript" varchar;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "videos" DROP COLUMN "transcript";
  ALTER TABLE "video_scenes" DROP COLUMN "pre_transcript";
  ALTER TABLE "video_scenes" DROP COLUMN "post_transcript";`)
}
