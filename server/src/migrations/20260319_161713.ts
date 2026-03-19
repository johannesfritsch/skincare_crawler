import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "videos" ADD COLUMN "audio_file_id" integer;
  ALTER TABLE "videos" ADD CONSTRAINT "videos_audio_file_id_video_media_id_fk" FOREIGN KEY ("audio_file_id") REFERENCES "public"."video_media"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "videos_audio_file_idx" ON "videos" USING btree ("audio_file_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "videos" DROP CONSTRAINT "videos_audio_file_id_video_media_id_fk";
  
  DROP INDEX "videos_audio_file_idx";
  ALTER TABLE "videos" DROP COLUMN "audio_file_id";`)
}
