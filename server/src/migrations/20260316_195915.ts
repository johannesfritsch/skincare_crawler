import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "source_products_brand_name_idx";
  ALTER TABLE "source_products" ADD COLUMN "source_brand_id" integer;
  ALTER TABLE "source_products" ADD CONSTRAINT "source_products_source_brand_id_source_brands_id_fk" FOREIGN KEY ("source_brand_id") REFERENCES "public"."source_brands"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "source_products_source_brand_idx" ON "source_products" USING btree ("source_brand_id");
  ALTER TABLE "source_products" DROP COLUMN "brand_name";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "source_products" DROP CONSTRAINT "source_products_source_brand_id_source_brands_id_fk";
  
  DROP INDEX "source_products_source_brand_idx";
  ALTER TABLE "source_products" ADD COLUMN "brand_name" varchar;
  CREATE INDEX "source_products_brand_name_idx" ON "source_products" USING btree ("brand_name");
  ALTER TABLE "source_products" DROP COLUMN "source_brand_id";`)
}
