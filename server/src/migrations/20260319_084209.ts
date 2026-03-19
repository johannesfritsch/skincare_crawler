import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_product_sentiment_conclusions_topic" AS ENUM('smell', 'texture', 'color', 'consistency', 'absorption', 'stickiness', 'lather', 'efficacy', 'longevity', 'finish', 'afterFeel', 'skinTolerance', 'allergenPotential', 'dispensing', 'travelSafety', 'animalTesting');
  CREATE TYPE "public"."enum_product_sentiment_conclusions_conclusion" AS ENUM('positive', 'negative', 'divided');
  CREATE TYPE "public"."enum_product_sentiment_conclusions_strength" AS ENUM('low', 'medium', 'high', 'ultra');
  CREATE TABLE "product_sentiment_conclusions" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"product_id" integer NOT NULL,
  	"topic" "enum_product_sentiment_conclusions_topic" NOT NULL,
  	"conclusion" "enum_product_sentiment_conclusions_conclusion" NOT NULL,
  	"strength" "enum_product_sentiment_conclusions_strength" NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "product_aggregations" ADD COLUMN "stage_sentiment_conclusion" boolean DEFAULT true;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "product_sentiment_conclusions_id" integer;
  ALTER TABLE "product_sentiment_conclusions" ADD CONSTRAINT "product_sentiment_conclusions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "product_sentiment_conclusions_product_idx" ON "product_sentiment_conclusions" USING btree ("product_id");
  CREATE INDEX "product_sentiment_conclusions_topic_idx" ON "product_sentiment_conclusions" USING btree ("topic");
  CREATE INDEX "product_sentiment_conclusions_updated_at_idx" ON "product_sentiment_conclusions" USING btree ("updated_at");
  CREATE INDEX "product_sentiment_conclusions_created_at_idx" ON "product_sentiment_conclusions" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_product_sentiment_conclusio_fk" FOREIGN KEY ("product_sentiment_conclusions_id") REFERENCES "public"."product_sentiment_conclusions"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_product_sentiment_conclusi_idx" ON "payload_locked_documents_rels" USING btree ("product_sentiment_conclusions_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "product_sentiment_conclusions" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "product_sentiment_conclusions" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_product_sentiment_conclusio_fk";
  
  DROP INDEX "payload_locked_documents_rels_product_sentiment_conclusi_idx";
  ALTER TABLE "product_aggregations" DROP COLUMN "stage_sentiment_conclusion";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "product_sentiment_conclusions_id";
  DROP TYPE "public"."enum_product_sentiment_conclusions_topic";
  DROP TYPE "public"."enum_product_sentiment_conclusions_conclusion";
  DROP TYPE "public"."enum_product_sentiment_conclusions_strength";`)
}
