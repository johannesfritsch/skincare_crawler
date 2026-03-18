import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_product_sentiments_topic" AS ENUM('smell', 'texture', 'color', 'consistency', 'absorption', 'stickiness', 'lather', 'efficacy', 'longevity', 'finish', 'afterFeel', 'skinTolerance', 'allergenPotential', 'dispensing', 'travelSafety', 'animalTesting');
  CREATE TYPE "public"."enum_product_sentiments_sentiment" AS ENUM('positive', 'neutral', 'negative');
  CREATE TABLE "product_sentiments" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"product_id" integer NOT NULL,
  	"topic" "enum_product_sentiments_topic" NOT NULL,
  	"sentiment" "enum_product_sentiments_sentiment" NOT NULL,
  	"amount" numeric DEFAULT 0 NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "product_aggregations" ADD COLUMN "review_sentiment_chunk_size" numeric DEFAULT 50;
  ALTER TABLE "product_aggregations" ADD COLUMN "stage_review_sentiment" boolean DEFAULT true;
  ALTER TABLE "product_aggregations" ADD COLUMN "review_state" jsonb;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "product_sentiments_id" integer;
  ALTER TABLE "product_sentiments" ADD CONSTRAINT "product_sentiments_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "product_sentiments_product_idx" ON "product_sentiments" USING btree ("product_id");
  CREATE INDEX "product_sentiments_topic_idx" ON "product_sentiments" USING btree ("topic");
  CREATE INDEX "product_sentiments_updated_at_idx" ON "product_sentiments" USING btree ("updated_at");
  CREATE INDEX "product_sentiments_created_at_idx" ON "product_sentiments" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_product_sentiments_fk" FOREIGN KEY ("product_sentiments_id") REFERENCES "public"."product_sentiments"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_product_sentiments_id_idx" ON "payload_locked_documents_rels" USING btree ("product_sentiments_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "product_sentiments" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "product_sentiments" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_product_sentiments_fk";
  
  DROP INDEX "payload_locked_documents_rels_product_sentiments_id_idx";
  ALTER TABLE "product_aggregations" DROP COLUMN "review_sentiment_chunk_size";
  ALTER TABLE "product_aggregations" DROP COLUMN "stage_review_sentiment";
  ALTER TABLE "product_aggregations" DROP COLUMN "review_state";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "product_sentiments_id";
  DROP TYPE "public"."enum_product_sentiments_topic";
  DROP TYPE "public"."enum_product_sentiments_sentiment";`)
}
