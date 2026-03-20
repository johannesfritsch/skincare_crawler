import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "product_aggregations" ALTER COLUMN "detection_threshold" SET DEFAULT 0.7;
  ALTER TABLE "product_aggregations" ADD COLUMN "fallback_detection_threshold" boolean DEFAULT true;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "product_aggregations" ALTER COLUMN "detection_threshold" SET DEFAULT 0.15;
  ALTER TABLE "product_aggregations" DROP COLUMN "fallback_detection_threshold";`)
}
