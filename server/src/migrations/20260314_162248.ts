import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_video_snippets_matching_type" RENAME TO "enum_video_scenes_matching_type";
  ALTER TABLE "video_snippets" RENAME TO "video_scenes";
  ALTER TABLE "video_snippets_rels" RENAME TO "video_scenes_rels";
  ALTER TABLE "video_frames" RENAME COLUMN "snippet_id" TO "scene_id";
  ALTER TABLE "video_mentions" RENAME COLUMN "video_snippet_id" TO "video_scene_id";
  ALTER TABLE "payload_locked_documents_rels" RENAME COLUMN "video_snippets_id" TO "video_scenes_id";
  ALTER TABLE "video_scenes" DROP CONSTRAINT "video_snippets_video_id_videos_id_fk";
  
  ALTER TABLE "video_scenes" DROP CONSTRAINT "video_snippets_image_id_video_media_id_fk";
  
  ALTER TABLE "video_scenes_rels" DROP CONSTRAINT "video_snippets_rels_parent_fk";
  
  ALTER TABLE "video_scenes_rels" DROP CONSTRAINT "video_snippets_rels_products_fk";
  
  ALTER TABLE "video_frames" DROP CONSTRAINT "video_frames_snippet_id_video_snippets_id_fk";
  
  ALTER TABLE "video_mentions" DROP CONSTRAINT "video_mentions_video_snippet_id_video_snippets_id_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_video_snippets_fk";
  
  DROP INDEX "video_snippets_video_idx";
  DROP INDEX "video_snippets_image_idx";
  DROP INDEX "video_snippets_updated_at_idx";
  DROP INDEX "video_snippets_created_at_idx";
  DROP INDEX "video_snippets_rels_order_idx";
  DROP INDEX "video_snippets_rels_parent_idx";
  DROP INDEX "video_snippets_rels_path_idx";
  DROP INDEX "video_snippets_rels_products_id_idx";
  DROP INDEX "video_frames_snippet_idx";
  DROP INDEX "video_mentions_video_snippet_idx";
  DROP INDEX "payload_locked_documents_rels_video_snippets_id_idx";
  ALTER TABLE "video_scenes" ADD CONSTRAINT "video_scenes_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "video_scenes" ADD CONSTRAINT "video_scenes_image_id_video_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."video_media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "video_scenes_rels" ADD CONSTRAINT "video_scenes_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."video_scenes"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "video_scenes_rels" ADD CONSTRAINT "video_scenes_rels_products_fk" FOREIGN KEY ("products_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "video_frames" ADD CONSTRAINT "video_frames_scene_id_video_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."video_scenes"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "video_mentions" ADD CONSTRAINT "video_mentions_video_scene_id_video_scenes_id_fk" FOREIGN KEY ("video_scene_id") REFERENCES "public"."video_scenes"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_video_scenes_fk" FOREIGN KEY ("video_scenes_id") REFERENCES "public"."video_scenes"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "video_scenes_video_idx" ON "video_scenes" USING btree ("video_id");
  CREATE INDEX "video_scenes_image_idx" ON "video_scenes" USING btree ("image_id");
  CREATE INDEX "video_scenes_updated_at_idx" ON "video_scenes" USING btree ("updated_at");
  CREATE INDEX "video_scenes_created_at_idx" ON "video_scenes" USING btree ("created_at");
  CREATE INDEX "video_scenes_rels_order_idx" ON "video_scenes_rels" USING btree ("order");
  CREATE INDEX "video_scenes_rels_parent_idx" ON "video_scenes_rels" USING btree ("parent_id");
  CREATE INDEX "video_scenes_rels_path_idx" ON "video_scenes_rels" USING btree ("path");
  CREATE INDEX "video_scenes_rels_products_id_idx" ON "video_scenes_rels" USING btree ("products_id");
  CREATE INDEX "video_frames_scene_idx" ON "video_frames" USING btree ("scene_id");
  CREATE INDEX "video_mentions_video_scene_idx" ON "video_mentions" USING btree ("video_scene_id");
  CREATE INDEX "payload_locked_documents_rels_video_scenes_id_idx" ON "payload_locked_documents_rels" USING btree ("video_scenes_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_video_scenes_matching_type" RENAME TO "enum_video_snippets_matching_type";
  ALTER TABLE "video_scenes" RENAME TO "video_snippets";
  ALTER TABLE "video_scenes_rels" RENAME TO "video_snippets_rels";
  ALTER TABLE "video_frames" RENAME COLUMN "scene_id" TO "snippet_id";
  ALTER TABLE "video_mentions" RENAME COLUMN "video_scene_id" TO "video_snippet_id";
  ALTER TABLE "payload_locked_documents_rels" RENAME COLUMN "video_scenes_id" TO "video_snippets_id";
  ALTER TABLE "video_snippets" DROP CONSTRAINT "video_scenes_video_id_videos_id_fk";
  
  ALTER TABLE "video_snippets" DROP CONSTRAINT "video_scenes_image_id_video_media_id_fk";
  
  ALTER TABLE "video_snippets_rels" DROP CONSTRAINT "video_scenes_rels_parent_fk";
  
  ALTER TABLE "video_snippets_rels" DROP CONSTRAINT "video_scenes_rels_products_fk";
  
  ALTER TABLE "video_frames" DROP CONSTRAINT "video_frames_scene_id_video_scenes_id_fk";
  
  ALTER TABLE "video_mentions" DROP CONSTRAINT "video_mentions_video_scene_id_video_scenes_id_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_video_scenes_fk";
  
  DROP INDEX "video_scenes_video_idx";
  DROP INDEX "video_scenes_image_idx";
  DROP INDEX "video_scenes_updated_at_idx";
  DROP INDEX "video_scenes_created_at_idx";
  DROP INDEX "video_scenes_rels_order_idx";
  DROP INDEX "video_scenes_rels_parent_idx";
  DROP INDEX "video_scenes_rels_path_idx";
  DROP INDEX "video_scenes_rels_products_id_idx";
  DROP INDEX "video_frames_scene_idx";
  DROP INDEX "video_mentions_video_scene_idx";
  DROP INDEX "payload_locked_documents_rels_video_scenes_id_idx";
  ALTER TABLE "video_snippets" ADD CONSTRAINT "video_snippets_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "video_snippets" ADD CONSTRAINT "video_snippets_image_id_video_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."video_media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "video_snippets_rels" ADD CONSTRAINT "video_snippets_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."video_snippets"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "video_snippets_rels" ADD CONSTRAINT "video_snippets_rels_products_fk" FOREIGN KEY ("products_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "video_frames" ADD CONSTRAINT "video_frames_snippet_id_video_snippets_id_fk" FOREIGN KEY ("snippet_id") REFERENCES "public"."video_snippets"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "video_mentions" ADD CONSTRAINT "video_mentions_video_snippet_id_video_snippets_id_fk" FOREIGN KEY ("video_snippet_id") REFERENCES "public"."video_snippets"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_video_snippets_fk" FOREIGN KEY ("video_snippets_id") REFERENCES "public"."video_snippets"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "video_snippets_video_idx" ON "video_snippets" USING btree ("video_id");
  CREATE INDEX "video_snippets_image_idx" ON "video_snippets" USING btree ("image_id");
  CREATE INDEX "video_snippets_updated_at_idx" ON "video_snippets" USING btree ("updated_at");
  CREATE INDEX "video_snippets_created_at_idx" ON "video_snippets" USING btree ("created_at");
  CREATE INDEX "video_snippets_rels_order_idx" ON "video_snippets_rels" USING btree ("order");
  CREATE INDEX "video_snippets_rels_parent_idx" ON "video_snippets_rels" USING btree ("parent_id");
  CREATE INDEX "video_snippets_rels_path_idx" ON "video_snippets_rels" USING btree ("path");
  CREATE INDEX "video_snippets_rels_products_id_idx" ON "video_snippets_rels" USING btree ("products_id");
  CREATE INDEX "video_frames_snippet_idx" ON "video_frames" USING btree ("snippet_id");
  CREATE INDEX "video_mentions_video_snippet_idx" ON "video_mentions" USING btree ("video_snippet_id");
  CREATE INDEX "payload_locked_documents_rels_video_snippets_id_idx" ON "payload_locked_documents_rels" USING btree ("video_snippets_id");`)
}
