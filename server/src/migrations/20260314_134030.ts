import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_product_variants_images_visibility" AS ENUM('public', 'recognition_only');
  CREATE TYPE "public"."enum_product_variants_images_source" AS ENUM('dm', 'rossmann', 'mueller', 'purish');
  ALTER TABLE "product_variants_images" ADD COLUMN "visibility" "enum_product_variants_images_visibility" DEFAULT 'public';
  ALTER TABLE "product_variants_images" ADD COLUMN "source" "enum_product_variants_images_source";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "product_variants_images" DROP COLUMN "visibility";
  ALTER TABLE "product_variants_images" DROP COLUMN "source";
  DROP TYPE "public"."enum_product_variants_images_visibility";
  DROP TYPE "public"."enum_product_variants_images_source";`)
}
