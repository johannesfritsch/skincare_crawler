import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_product_variants_images_source" ADD VALUE 'shopapotheke';
  ALTER TYPE "public"."enum_source_products_source" ADD VALUE 'shopapotheke';
  ALTER TYPE "public"."enum_source_brands_source" ADD VALUE 'shopapotheke';
  ALTER TYPE "public"."enum_source_review_origins_source" ADD VALUE 'shopapotheke';
  ALTER TYPE "public"."enum_product_searches_sources" ADD VALUE 'shopapotheke';
  ALTER TYPE "public"."enum_product_crawls_source" ADD VALUE 'shopapotheke';
  ALTER TABLE "product_aggregations" ALTER COLUMN "image_source_priority" SET DEFAULT '["dm","rossmann","mueller","purish","douglas","shopapotheke"]'::jsonb;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "product_variants_images" ALTER COLUMN "source" SET DATA TYPE text;
  DROP TYPE "public"."enum_product_variants_images_source";
  CREATE TYPE "public"."enum_product_variants_images_source" AS ENUM('dm', 'rossmann', 'mueller', 'purish', 'douglas');
  ALTER TABLE "product_variants_images" ALTER COLUMN "source" SET DATA TYPE "public"."enum_product_variants_images_source" USING "source"::"public"."enum_product_variants_images_source";
  ALTER TABLE "source_products" ALTER COLUMN "source" SET DATA TYPE text;
  DROP TYPE "public"."enum_source_products_source";
  CREATE TYPE "public"."enum_source_products_source" AS ENUM('dm', 'rossmann', 'mueller', 'purish', 'douglas');
  ALTER TABLE "source_products" ALTER COLUMN "source" SET DATA TYPE "public"."enum_source_products_source" USING "source"::"public"."enum_source_products_source";
  ALTER TABLE "source_brands" ALTER COLUMN "source" SET DATA TYPE text;
  DROP TYPE "public"."enum_source_brands_source";
  CREATE TYPE "public"."enum_source_brands_source" AS ENUM('dm', 'rossmann', 'mueller', 'purish', 'douglas');
  ALTER TABLE "source_brands" ALTER COLUMN "source" SET DATA TYPE "public"."enum_source_brands_source" USING "source"::"public"."enum_source_brands_source";
  ALTER TABLE "source_review_origins" ALTER COLUMN "source" SET DATA TYPE text;
  DROP TYPE "public"."enum_source_review_origins_source";
  CREATE TYPE "public"."enum_source_review_origins_source" AS ENUM('dm', 'rossmann', 'mueller', 'purish', 'douglas');
  ALTER TABLE "source_review_origins" ALTER COLUMN "source" SET DATA TYPE "public"."enum_source_review_origins_source" USING "source"::"public"."enum_source_review_origins_source";
  ALTER TABLE "product_searches_sources" ALTER COLUMN "value" SET DATA TYPE text;
  DROP TYPE "public"."enum_product_searches_sources";
  CREATE TYPE "public"."enum_product_searches_sources" AS ENUM('dm', 'rossmann', 'mueller', 'purish', 'douglas');
  ALTER TABLE "product_searches_sources" ALTER COLUMN "value" SET DATA TYPE "public"."enum_product_searches_sources" USING "value"::"public"."enum_product_searches_sources";
  ALTER TABLE "product_crawls" ALTER COLUMN "source" SET DATA TYPE text;
  ALTER TABLE "product_crawls" ALTER COLUMN "source" SET DEFAULT 'all'::text;
  DROP TYPE "public"."enum_product_crawls_source";
  CREATE TYPE "public"."enum_product_crawls_source" AS ENUM('all', 'dm', 'rossmann', 'mueller', 'purish', 'douglas');
  ALTER TABLE "product_crawls" ALTER COLUMN "source" SET DEFAULT 'all'::"public"."enum_product_crawls_source";
  ALTER TABLE "product_crawls" ALTER COLUMN "source" SET DATA TYPE "public"."enum_product_crawls_source" USING "source"::"public"."enum_product_crawls_source";
  ALTER TABLE "product_aggregations" ALTER COLUMN "image_source_priority" SET DEFAULT '["dm","rossmann","mueller","purish","douglas"]'::jsonb;`)
}
