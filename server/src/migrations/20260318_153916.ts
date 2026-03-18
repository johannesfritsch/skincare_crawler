import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "product_crawls" ADD COLUMN "stage_scrape" boolean DEFAULT true;
  ALTER TABLE "product_crawls" ADD COLUMN "stage_reviews" boolean DEFAULT true;
  ALTER TABLE "product_crawls" ADD COLUMN "crawl_progress" jsonb;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "product_crawls" DROP COLUMN "stage_scrape";
  ALTER TABLE "product_crawls" DROP COLUMN "stage_reviews";
  ALTER TABLE "product_crawls" DROP COLUMN "crawl_progress";`)
}
