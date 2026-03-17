import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "videos" ALTER COLUMN "status" SET DATA TYPE text;
  ALTER TABLE "videos" ALTER COLUMN "status" SET DEFAULT 'crawled'::text;
  DROP TYPE "public"."enum_videos_status";
  CREATE TYPE "public"."enum_videos_status" AS ENUM('crawled', 'processed');
  ALTER TABLE "videos" ALTER COLUMN "status" SET DEFAULT 'crawled'::"public"."enum_videos_status";
  ALTER TABLE "videos" ALTER COLUMN "status" SET DATA TYPE "public"."enum_videos_status" USING "status"::"public"."enum_videos_status";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_videos_status" ADD VALUE 'discovered' BEFORE 'crawled';
  ALTER TABLE "videos" ALTER COLUMN "status" SET DEFAULT 'discovered';`)
}
