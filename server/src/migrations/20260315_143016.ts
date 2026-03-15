import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "video_processings" ALTER COLUMN "transcription_model" SET DATA TYPE varchar;
  ALTER TABLE "video_processings" ALTER COLUMN "transcription_model" SET DEFAULT 'whisper-1';
  DROP TYPE "public"."enum_video_processings_transcription_model";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_video_processings_transcription_model" AS ENUM('nova-3', 'nova-2', 'enhanced', 'base');
  ALTER TABLE "video_processings" ALTER COLUMN "transcription_model" SET DEFAULT 'nova-3'::"public"."enum_video_processings_transcription_model";
  ALTER TABLE "video_processings" ALTER COLUMN "transcription_model" SET DATA TYPE "public"."enum_video_processings_transcription_model" USING "transcription_model"::"public"."enum_video_processings_transcription_model";`)
}
