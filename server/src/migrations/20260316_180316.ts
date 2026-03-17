import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_source_brands_source" AS ENUM('dm', 'rossmann', 'mueller', 'purish');
  CREATE TABLE "source_brands" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"source" "enum_source_brands_source" NOT NULL,
  	"source_url" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "source_brands_id" integer;
  CREATE INDEX "source_brands_name_idx" ON "source_brands" USING btree ("name");
  CREATE INDEX "source_brands_source_idx" ON "source_brands" USING btree ("source");
  CREATE UNIQUE INDEX "source_brands_source_url_idx" ON "source_brands" USING btree ("source_url");
  CREATE INDEX "source_brands_updated_at_idx" ON "source_brands" USING btree ("updated_at");
  CREATE INDEX "source_brands_created_at_idx" ON "source_brands" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_source_brands_fk" FOREIGN KEY ("source_brands_id") REFERENCES "public"."source_brands"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_source_brands_id_idx" ON "payload_locked_documents_rels" USING btree ("source_brands_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "source_brands" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "source_brands" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_source_brands_fk";
  
  DROP INDEX "payload_locked_documents_rels_source_brands_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "source_brands_id";
  DROP TYPE "public"."enum_source_brands_source";`)
}
