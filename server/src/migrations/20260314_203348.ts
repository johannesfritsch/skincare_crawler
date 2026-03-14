import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    -- Drop the HNSW index (incompatible with column resize)
    DROP INDEX IF EXISTS "idx_recognition_images_embedding";

    -- Clear all existing embeddings (they're 512-dim CLIP, incompatible with 384-dim DINOv2)
    UPDATE "product_variants_recognition_images"
      SET "embedding" = NULL, "has_embedding" = false;

    -- Resize the vector column from 512 to 384 dimensions
    ALTER TABLE "product_variants_recognition_images"
      ALTER COLUMN "embedding" TYPE vector(384);

    -- Recreate the HNSW index for the new dimension
    CREATE INDEX "idx_recognition_images_embedding"
      ON "product_variants_recognition_images"
      USING hnsw ("embedding" vector_cosine_ops);
  `)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP INDEX IF EXISTS "idx_recognition_images_embedding";

    UPDATE "product_variants_recognition_images"
      SET "embedding" = NULL, "has_embedding" = false;

    ALTER TABLE "product_variants_recognition_images"
      ALTER COLUMN "embedding" TYPE vector(512);

    CREATE INDEX "idx_recognition_images_embedding"
      ON "product_variants_recognition_images"
      USING hnsw ("embedding" vector_cosine_ops);
  `)
}
