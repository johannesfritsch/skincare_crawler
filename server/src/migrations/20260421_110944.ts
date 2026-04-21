import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "gallery_comments" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"gallery_id" integer NOT NULL,
  	"external_id" varchar,
  	"username" varchar NOT NULL,
  	"text" varchar NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"like_count" numeric DEFAULT 0,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "galleries_comments" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "galleries_comments" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "gallery_comments_id" integer;
  ALTER TABLE "gallery_comments" ADD CONSTRAINT "gallery_comments_gallery_id_galleries_id_fk" FOREIGN KEY ("gallery_id") REFERENCES "public"."galleries"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "gallery_comments_gallery_idx" ON "gallery_comments" USING btree ("gallery_id");
  CREATE INDEX "gallery_comments_external_id_idx" ON "gallery_comments" USING btree ("external_id");
  CREATE INDEX "gallery_comments_updated_at_idx" ON "gallery_comments" USING btree ("updated_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_gallery_comments_fk" FOREIGN KEY ("gallery_comments_id") REFERENCES "public"."gallery_comments"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_gallery_comments_id_idx" ON "payload_locked_documents_rels" USING btree ("gallery_comments_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "galleries_comments" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"external_id" varchar,
  	"username" varchar,
  	"created_at" timestamp(3) with time zone,
  	"like_count" numeric,
  	"text" varchar
  );
  
  ALTER TABLE "gallery_comments" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "gallery_comments" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_gallery_comments_fk";
  
  DROP INDEX "payload_locked_documents_rels_gallery_comments_id_idx";
  ALTER TABLE "galleries_comments" ADD CONSTRAINT "galleries_comments_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."galleries"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "galleries_comments_order_idx" ON "galleries_comments" USING btree ("_order");
  CREATE INDEX "galleries_comments_parent_id_idx" ON "galleries_comments" USING btree ("_parent_id");
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "gallery_comments_id";`)
}
