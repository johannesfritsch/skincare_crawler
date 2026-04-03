import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "video_discoveries" ADD COLUMN "date_limit" varchar;
  ALTER TABLE "video_discoveries" DROP COLUMN "days_back";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "video_discoveries" ADD COLUMN "days_back" numeric;
  ALTER TABLE "video_discoveries" DROP COLUMN "date_limit";`)
}
