import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "crawler_settings" ALTER COLUMN "alert_email" SET DEFAULT 'fritsch@zoom7.de';
  ALTER TABLE "crawler_settings" ADD COLUMN "instagram_cookies_file" varchar;
  ALTER TABLE "crawler_settings" ADD COLUMN "tiktok_cookies_file" varchar;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "crawler_settings" ALTER COLUMN "alert_email" DROP DEFAULT;
  ALTER TABLE "crawler_settings" DROP COLUMN "instagram_cookies_file";
  ALTER TABLE "crawler_settings" DROP COLUMN "tiktok_cookies_file";`)
}
