import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "source_reviews" DROP CONSTRAINT "source_reviews_source_product_id_source_products_id_fk";
  
  DROP INDEX "source_reviews_source_product_idx";
  ALTER TABLE "source_reviews" ADD COLUMN "source_variant_id" integer NOT NULL;
  ALTER TABLE "source_reviews" ADD CONSTRAINT "source_reviews_source_variant_id_source_variants_id_fk" FOREIGN KEY ("source_variant_id") REFERENCES "public"."source_variants"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "source_reviews_source_variant_idx" ON "source_reviews" USING btree ("source_variant_id");
  ALTER TABLE "source_reviews" DROP COLUMN "source_product_id";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "source_reviews" DROP CONSTRAINT "source_reviews_source_variant_id_source_variants_id_fk";
  
  DROP INDEX "source_reviews_source_variant_idx";
  ALTER TABLE "source_reviews" ADD COLUMN "source_product_id" integer NOT NULL;
  ALTER TABLE "source_reviews" ADD CONSTRAINT "source_reviews_source_product_id_source_products_id_fk" FOREIGN KEY ("source_product_id") REFERENCES "public"."source_products"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "source_reviews_source_product_idx" ON "source_reviews" USING btree ("source_product_id");
  ALTER TABLE "source_reviews" DROP COLUMN "source_variant_id";`)
}
