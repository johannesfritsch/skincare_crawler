import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "source_reviews" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"source_product_id" integer NOT NULL,
  	"external_id" varchar,
  	"rating" numeric NOT NULL,
  	"submitted_at" timestamp(3) with time zone,
  	"title" varchar,
  	"review_text" varchar,
  	"user_nickname" varchar,
  	"reviewer_age" varchar,
  	"reviewer_gender" varchar,
  	"is_recommended" boolean,
  	"positive_feedback_count" numeric DEFAULT 0,
  	"negative_feedback_count" numeric DEFAULT 0,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "source_products" RENAME COLUMN "rating" TO "average_rating";
  ALTER TABLE "source_products" RENAME COLUMN "rating_num" TO "rating_count";
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "source_reviews_id" integer;
  ALTER TABLE "source_reviews" ADD CONSTRAINT "source_reviews_source_product_id_source_products_id_fk" FOREIGN KEY ("source_product_id") REFERENCES "public"."source_products"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "source_reviews_source_product_idx" ON "source_reviews" USING btree ("source_product_id");
  CREATE UNIQUE INDEX "source_reviews_external_id_idx" ON "source_reviews" USING btree ("external_id");
  CREATE INDEX "source_reviews_updated_at_idx" ON "source_reviews" USING btree ("updated_at");
  CREATE INDEX "source_reviews_created_at_idx" ON "source_reviews" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_source_reviews_fk" FOREIGN KEY ("source_reviews_id") REFERENCES "public"."source_reviews"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_source_reviews_id_idx" ON "payload_locked_documents_rels" USING btree ("source_reviews_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "source_reviews" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "source_reviews" CASCADE;
  ALTER TABLE "source_products" RENAME COLUMN "average_rating" TO "rating";
  ALTER TABLE "source_products" RENAME COLUMN "rating_count" TO "rating_num";
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_source_reviews_fk";
  
  DROP INDEX "payload_locked_documents_rels_source_reviews_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "source_reviews_id";`)
}
