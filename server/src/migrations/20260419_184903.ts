import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "gallery_processings" ADD COLUMN "tokens_recognition" numeric DEFAULT 0;
  ALTER TABLE "gallery_processings" ADD COLUMN "tokens_sentiment" numeric DEFAULT 0;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "gallery_processings" DROP COLUMN "tokens_recognition";
  ALTER TABLE "gallery_processings" DROP COLUMN "tokens_sentiment";`)
}
