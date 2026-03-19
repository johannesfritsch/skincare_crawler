import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
    // Upgrade recognition_embeddings: DINOv2-small (384-dim) → DINOv2-base (768-dim)
    // + add augmentation_type column for synthetic perspective augmentations (8 per crop)
    await db.execute(sql`
        TRUNCATE TABLE "recognition_embeddings";

        ALTER TABLE "recognition_embeddings"
            ADD COLUMN "augmentation_type" text NOT NULL DEFAULT 'original';

        ALTER TABLE "recognition_embeddings"
            DROP CONSTRAINT "recognition_embeddings_variant_media_unique";

        DROP INDEX IF EXISTS "idx_recognition_embeddings_hnsw";

        ALTER TABLE "recognition_embeddings"
            ALTER COLUMN "embedding" TYPE vector(768);

        ALTER TABLE "recognition_embeddings"
            ADD CONSTRAINT "recognition_embeddings_variant_media_aug_unique"
            UNIQUE("product_variant_id", "detection_media_id", "augmentation_type");

        CREATE INDEX "idx_recognition_embeddings_hnsw"
            ON "recognition_embeddings" USING hnsw ("embedding" vector_cosine_ops);
    `)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
    // Revert to DINOv2-small (384-dim), remove augmentation_type
    await db.execute(sql`
        TRUNCATE TABLE "recognition_embeddings";

        DROP INDEX IF EXISTS "idx_recognition_embeddings_hnsw";

        ALTER TABLE "recognition_embeddings"
            DROP CONSTRAINT "recognition_embeddings_variant_media_aug_unique";

        ALTER TABLE "recognition_embeddings"
            DROP COLUMN "augmentation_type";

        ALTER TABLE "recognition_embeddings"
            ALTER COLUMN "embedding" TYPE vector(384);

        ALTER TABLE "recognition_embeddings"
            ADD CONSTRAINT "recognition_embeddings_variant_media_unique"
            UNIQUE("product_variant_id", "detection_media_id");

        CREATE INDEX "idx_recognition_embeddings_hnsw"
            ON "recognition_embeddings" USING hnsw ("embedding" vector_cosine_ops);
    `)
}
