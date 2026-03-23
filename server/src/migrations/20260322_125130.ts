import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_product_sentiment_conclusions_group_type" AS ENUM('all', 'incentivized', 'organic', 'individual');
  ALTER TABLE "product_sentiments" ADD COLUMN "review_origin_id" integer;
  ALTER TABLE "product_sentiment_conclusions" ADD COLUMN "group_type" "enum_product_sentiment_conclusions_group_type" DEFAULT 'all' NOT NULL;
  ALTER TABLE "product_sentiment_conclusions" ADD COLUMN "review_origin_id" integer;
  ALTER TABLE "product_sentiments" ADD CONSTRAINT "product_sentiments_review_origin_id_source_review_origins_id_fk" FOREIGN KEY ("review_origin_id") REFERENCES "public"."source_review_origins"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "product_sentiment_conclusions" ADD CONSTRAINT "product_sentiment_conclusions_review_origin_id_source_review_origins_id_fk" FOREIGN KEY ("review_origin_id") REFERENCES "public"."source_review_origins"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "product_sentiments_review_origin_idx" ON "product_sentiments" USING btree ("review_origin_id");
  CREATE INDEX "product_sentiment_conclusions_group_type_idx" ON "product_sentiment_conclusions" USING btree ("group_type");
  CREATE INDEX "product_sentiment_conclusions_review_origin_idx" ON "product_sentiment_conclusions" USING btree ("review_origin_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "product_sentiments" DROP CONSTRAINT "product_sentiments_review_origin_id_source_review_origins_id_fk";
  
  ALTER TABLE "product_sentiment_conclusions" DROP CONSTRAINT "product_sentiment_conclusions_review_origin_id_source_review_origins_id_fk";
  
  DROP INDEX "product_sentiments_review_origin_idx";
  DROP INDEX "product_sentiment_conclusions_group_type_idx";
  DROP INDEX "product_sentiment_conclusions_review_origin_idx";
  ALTER TABLE "product_sentiments" DROP COLUMN "review_origin_id";
  ALTER TABLE "product_sentiment_conclusions" DROP COLUMN "group_type";
  ALTER TABLE "product_sentiment_conclusions" DROP COLUMN "review_origin_id";
  DROP TYPE "public"."enum_product_sentiment_conclusions_group_type";`)
}
