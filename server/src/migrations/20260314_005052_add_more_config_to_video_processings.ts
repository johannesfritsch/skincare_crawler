import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "video_processings" ADD COLUMN "search_threshold" numeric DEFAULT 0.3;
  ALTER TABLE "video_processings" ADD COLUMN "search_limit" numeric DEFAULT 1;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "video_processings" DROP COLUMN "search_threshold";
  ALTER TABLE "video_processings" DROP COLUMN "search_limit";`)
}
