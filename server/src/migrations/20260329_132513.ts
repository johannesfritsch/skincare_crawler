import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_events_level" ADD VALUE 'critical';
  CREATE TABLE "crawler_settings" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"alert_email" varchar,
  	"last_critical_email_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  ALTER TABLE "product_crawls" ADD COLUMN "crawl_snapshot" jsonb;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "crawler_settings" CASCADE;
  ALTER TABLE "events" ALTER COLUMN "level" SET DATA TYPE text;
  ALTER TABLE "events" ALTER COLUMN "level" SET DEFAULT 'info'::text;
  DROP TYPE "public"."enum_events_level";
  CREATE TYPE "public"."enum_events_level" AS ENUM('debug', 'info', 'warn', 'error');
  ALTER TABLE "events" ALTER COLUMN "level" SET DEFAULT 'info'::"public"."enum_events_level";
  ALTER TABLE "events" ALTER COLUMN "level" SET DATA TYPE "public"."enum_events_level" USING "level"::"public"."enum_events_level";
  ALTER TABLE "product_crawls" DROP COLUMN "crawl_snapshot";`)
}
