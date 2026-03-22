import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_source_review_origins_source" AS ENUM('dm', 'rossmann', 'mueller', 'purish');
  CREATE TABLE "source_review_origins" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"source" "enum_source_review_origins_source" NOT NULL,
  	"incentivized" boolean,
  	"reasoning" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "source_reviews" ADD COLUMN "review_origin_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "source_review_origins_id" integer;
  CREATE UNIQUE INDEX "source_review_origins_name_source_idx" ON "source_review_origins" ("name", "source");
  CREATE INDEX "source_review_origins_name_idx" ON "source_review_origins" USING btree ("name");
  CREATE INDEX "source_review_origins_source_idx" ON "source_review_origins" USING btree ("source");
  CREATE INDEX "source_review_origins_updated_at_idx" ON "source_review_origins" USING btree ("updated_at");
  CREATE INDEX "source_review_origins_created_at_idx" ON "source_review_origins" USING btree ("created_at");
  ALTER TABLE "source_reviews" ADD CONSTRAINT "source_reviews_review_origin_id_source_review_origins_id_fk" FOREIGN KEY ("review_origin_id") REFERENCES "public"."source_review_origins"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_source_review_origins_fk" FOREIGN KEY ("source_review_origins_id") REFERENCES "public"."source_review_origins"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "source_reviews_review_origin_idx" ON "source_reviews" USING btree ("review_origin_id");
  CREATE INDEX "payload_locked_documents_rels_source_review_origins_id_idx" ON "payload_locked_documents_rels" USING btree ("source_review_origins_id");
  ALTER TABLE "source_reviews" DROP COLUMN IF EXISTS "review_source";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "source_review_origins_name_source_idx";
  ALTER TABLE "source_review_origins" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "source_review_origins" CASCADE;
  ALTER TABLE "source_reviews" DROP CONSTRAINT "source_reviews_review_origin_id_source_review_origins_id_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_source_review_origins_fk";
  
  DROP INDEX "source_reviews_review_origin_idx";
  DROP INDEX "payload_locked_documents_rels_source_review_origins_id_idx";
  ALTER TABLE "source_reviews" ADD COLUMN "review_source" varchar;
  ALTER TABLE "source_reviews" DROP COLUMN "review_origin_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "source_review_origins_id";
  DROP TYPE "public"."enum_source_review_origins_source";`)
}
