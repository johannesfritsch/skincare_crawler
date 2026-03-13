import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "product_variants_recognition_images" ADD COLUMN "has_embedding" boolean DEFAULT false;
  ALTER TABLE "product_aggregations" ADD COLUMN "stage_embed_images" boolean DEFAULT true;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "product_variants_recognition_images" DROP COLUMN "has_embedding";
  ALTER TABLE "product_aggregations" DROP COLUMN "stage_embed_images";`)
}
