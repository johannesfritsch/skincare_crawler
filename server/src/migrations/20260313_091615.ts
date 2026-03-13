import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "product_aggregations" ADD COLUMN "min_box_area" numeric DEFAULT 5;
  ALTER TABLE "video_processings" ADD COLUMN "min_box_area" numeric DEFAULT 25;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "product_aggregations" DROP COLUMN "min_box_area";
  ALTER TABLE "video_processings" DROP COLUMN "min_box_area";`)
}
