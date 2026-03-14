import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "product_variants_recognition_images"
      ADD COLUMN "embedding" vector(512);

    CREATE INDEX "idx_recognition_images_embedding"
      ON "product_variants_recognition_images"
      USING hnsw ("embedding" vector_cosine_ops);
  `)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP INDEX IF EXISTS "idx_recognition_images_embedding";

    ALTER TABLE "product_variants_recognition_images"
      DROP COLUMN IF EXISTS "embedding";
  `)
}
