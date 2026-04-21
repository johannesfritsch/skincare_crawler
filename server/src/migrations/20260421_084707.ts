import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
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
  
  ALTER TABLE "galleries_comments" ADD CONSTRAINT "galleries_comments_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."galleries"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "galleries_comments_order_idx" ON "galleries_comments" USING btree ("_order");
  CREATE INDEX "galleries_comments_parent_id_idx" ON "galleries_comments" USING btree ("_parent_id");
  ALTER TABLE "galleries" DROP COLUMN "comments";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "galleries_comments" CASCADE;
  ALTER TABLE "galleries" ADD COLUMN "comments" jsonb;`)
}
