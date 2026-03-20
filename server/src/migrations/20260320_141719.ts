import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "video_scenes_recognitions" ADD COLUMN "object" varchar;
  ALTER TABLE "video_scenes_recognitions" DROP COLUMN "object_index";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "video_scenes_recognitions" ADD COLUMN "object_index" numeric;
  ALTER TABLE "video_scenes_recognitions" DROP COLUMN "object";`)
}
