import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "video_mentions_quotes_summary" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"text" varchar NOT NULL
  );
  
  ALTER TABLE "video_mentions_quotes_summary" ADD CONSTRAINT "video_mentions_quotes_summary_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."video_mentions_quotes"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "video_mentions_quotes_summary_order_idx" ON "video_mentions_quotes_summary" USING btree ("_order");
  CREATE INDEX "video_mentions_quotes_summary_parent_id_idx" ON "video_mentions_quotes_summary" USING btree ("_parent_id");
  ALTER TABLE "video_mentions_quotes" DROP COLUMN "summary";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "video_mentions_quotes_summary" CASCADE;
  ALTER TABLE "video_mentions_quotes" ADD COLUMN "summary" jsonb;`)
}
