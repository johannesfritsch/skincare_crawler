import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "source_reviews_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"source_variants_id" integer
  );
  
  ALTER TABLE "source_reviews" DROP CONSTRAINT "source_reviews_source_variant_id_source_variants_id_fk";
  
  DROP INDEX "source_reviews_source_variant_idx";
  ALTER TABLE "source_reviews" ADD COLUMN "source_product_id" integer NOT NULL;
  ALTER TABLE "source_reviews_rels" ADD CONSTRAINT "source_reviews_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."source_reviews"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "source_reviews_rels" ADD CONSTRAINT "source_reviews_rels_source_variants_fk" FOREIGN KEY ("source_variants_id") REFERENCES "public"."source_variants"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "source_reviews_rels_order_idx" ON "source_reviews_rels" USING btree ("order");
  CREATE INDEX "source_reviews_rels_parent_idx" ON "source_reviews_rels" USING btree ("parent_id");
  CREATE INDEX "source_reviews_rels_path_idx" ON "source_reviews_rels" USING btree ("path");
  CREATE INDEX "source_reviews_rels_source_variants_id_idx" ON "source_reviews_rels" USING btree ("source_variants_id");
  ALTER TABLE "source_reviews" ADD CONSTRAINT "source_reviews_source_product_id_source_products_id_fk" FOREIGN KEY ("source_product_id") REFERENCES "public"."source_products"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "source_reviews_source_product_idx" ON "source_reviews" USING btree ("source_product_id");
  ALTER TABLE "source_reviews" DROP COLUMN "source_variant_id";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "source_reviews_rels" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "source_reviews_rels" CASCADE;
  ALTER TABLE "source_reviews" DROP CONSTRAINT "source_reviews_source_product_id_source_products_id_fk";
  
  DROP INDEX "source_reviews_source_product_idx";
  ALTER TABLE "source_reviews" ADD COLUMN "source_variant_id" integer NOT NULL;
  ALTER TABLE "source_reviews" ADD CONSTRAINT "source_reviews_source_variant_id_source_variants_id_fk" FOREIGN KEY ("source_variant_id") REFERENCES "public"."source_variants"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "source_reviews_source_variant_idx" ON "source_reviews" USING btree ("source_variant_id");
  ALTER TABLE "source_reviews" DROP COLUMN "source_product_id";`)
}
