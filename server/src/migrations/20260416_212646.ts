import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "test_suites_video_discoveries" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"channel_url" varchar NOT NULL,
  	"max_videos" numeric,
  	"check_schema" jsonb
  );
  
  CREATE TABLE "test_suites_video_crawls" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"urls" varchar NOT NULL,
  	"check_schema" jsonb
  );
  
  CREATE TABLE "test_suites_video_processings" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"urls" varchar NOT NULL,
  	"check_schema" jsonb
  );
  
  ALTER TABLE "test_suites_video_discoveries" ADD CONSTRAINT "test_suites_video_discoveries_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."test_suites"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "test_suites_video_crawls" ADD CONSTRAINT "test_suites_video_crawls_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."test_suites"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "test_suites_video_processings" ADD CONSTRAINT "test_suites_video_processings_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."test_suites"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "test_suites_video_discoveries_order_idx" ON "test_suites_video_discoveries" USING btree ("_order");
  CREATE INDEX "test_suites_video_discoveries_parent_id_idx" ON "test_suites_video_discoveries" USING btree ("_parent_id");
  CREATE INDEX "test_suites_video_crawls_order_idx" ON "test_suites_video_crawls" USING btree ("_order");
  CREATE INDEX "test_suites_video_crawls_parent_id_idx" ON "test_suites_video_crawls" USING btree ("_parent_id");
  CREATE INDEX "test_suites_video_processings_order_idx" ON "test_suites_video_processings" USING btree ("_order");
  CREATE INDEX "test_suites_video_processings_parent_id_idx" ON "test_suites_video_processings" USING btree ("_parent_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "test_suites_video_discoveries" CASCADE;
  DROP TABLE "test_suites_video_crawls" CASCADE;
  DROP TABLE "test_suites_video_processings" CASCADE;`)
}
