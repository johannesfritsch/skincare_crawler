import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "product_aggregations" ALTER COLUMN "review_sentiment_chunk_size" SET DEFAULT 20;
  ALTER TABLE "product_aggregations" ADD COLUMN "review_sentiment_timeout_sec" numeric DEFAULT 60;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "product_aggregations" ALTER COLUMN "review_sentiment_chunk_size" SET DEFAULT 50;
  ALTER TABLE "product_aggregations" DROP COLUMN "review_sentiment_timeout_sec";`)
}
