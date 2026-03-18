import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  // 1. Create the new standalone recognition_embeddings table
  await db.execute(sql`
    CREATE TABLE "recognition_embeddings" (
      "id" serial PRIMARY KEY NOT NULL,
      "product_variant_id" integer NOT NULL,
      "detection_media_id" integer NOT NULL,
      "embedding" vector(384),
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "recognition_embeddings_variant_media_unique"
        UNIQUE("product_variant_id", "detection_media_id")
    );

    ALTER TABLE "recognition_embeddings"
      ADD CONSTRAINT "recognition_embeddings_product_variant_id_fk"
      FOREIGN KEY ("product_variant_id") REFERENCES "public"."product_variants"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;

    ALTER TABLE "recognition_embeddings"
      ADD CONSTRAINT "recognition_embeddings_detection_media_id_fk"
      FOREIGN KEY ("detection_media_id") REFERENCES "public"."detection_media"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;

    CREATE INDEX "idx_recognition_embeddings_hnsw"
      ON "recognition_embeddings"
      USING hnsw ("embedding" vector_cosine_ops);

    CREATE INDEX "idx_recognition_embeddings_variant"
      ON "recognition_embeddings" ("product_variant_id");
  `)

  // 2. Migrate existing embeddings from the old sub-table to the new table.
  //    The old table used vector(512) but actual model output is 384-dim,
  //    so any existing embeddings with wrong dimensions are skipped.
  await db.execute(sql`
    INSERT INTO "recognition_embeddings" ("product_variant_id", "detection_media_id", "embedding")
    SELECT ri."_parent_id", ri."image_id", ri."embedding"
    FROM "product_variants_recognition_images" ri
    WHERE ri."embedding" IS NOT NULL
      AND array_length(string_to_array(trim(both '[]' from ri."embedding"::text), ','), 1) = 384
    ON CONFLICT ("product_variant_id", "detection_media_id") DO NOTHING
  `)

  // 3. Drop the old embedding column + HNSW index from the sub-table
  await db.execute(sql`
    DROP INDEX IF EXISTS "idx_recognition_images_embedding";
    ALTER TABLE "product_variants_recognition_images" DROP COLUMN IF EXISTS "embedding";
  `)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  // 1. Re-add the old embedding column on the sub-table
  await db.execute(sql`
    ALTER TABLE "product_variants_recognition_images"
      ADD COLUMN "embedding" vector(512);

    CREATE INDEX "idx_recognition_images_embedding"
      ON "product_variants_recognition_images"
      USING hnsw ("embedding" vector_cosine_ops);
  `)

  // 2. Drop the new table
  await db.execute(sql`
    DROP TABLE IF EXISTS "recognition_embeddings";
  `)
}
