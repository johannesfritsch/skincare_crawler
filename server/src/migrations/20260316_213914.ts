import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "brands" ADD COLUMN "image_id" integer;
  ALTER TABLE "product_aggregations" ADD COLUMN "brand_source_priority" jsonb DEFAULT '["rossmann","purish","dm","mueller"]'::jsonb;
  ALTER TABLE "brands" ADD CONSTRAINT "brands_image_id_profile_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."profile_media"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "brands_image_idx" ON "brands" USING btree ("image_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "brands" DROP CONSTRAINT "brands_image_id_profile_media_id_fk";
  
  DROP INDEX "brands_image_idx";
  ALTER TABLE "brands" DROP COLUMN "image_id";
  ALTER TABLE "product_aggregations" DROP COLUMN "brand_source_priority";`)
}
