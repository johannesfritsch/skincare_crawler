import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_video_scenes_objects_side" AS ENUM('front', 'back', 'unknown');
  ALTER TABLE "video_scenes_objects" ADD COLUMN "side" "enum_video_scenes_objects_side";
  ALTER TABLE "video_scenes_objects" ADD COLUMN "cluster_group" numeric;
  ALTER TABLE "video_scenes_objects" ADD COLUMN "is_representative" boolean;
  ALTER TABLE "video_processings" ADD COLUMN "stage_side_detection" boolean DEFAULT true;
  ALTER TABLE "videos" DROP COLUMN "transcript";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "videos" ADD COLUMN "transcript" varchar;
  ALTER TABLE "video_scenes_objects" DROP COLUMN "side";
  ALTER TABLE "video_scenes_objects" DROP COLUMN "cluster_group";
  ALTER TABLE "video_scenes_objects" DROP COLUMN "is_representative";
  ALTER TABLE "video_processings" DROP COLUMN "stage_side_detection";
  DROP TYPE "public"."enum_video_scenes_objects_side";`)
}
