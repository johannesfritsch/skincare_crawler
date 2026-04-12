import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Standardize progress fields across all job collections.
 * Every job table gets: total, completed, errors, started_at, completed_at
 *
 * Renames:
 *   crawled → completed      (product_crawls, video_crawls, ingredient_crawls)
 *   discovered → completed   (product_searches, product_discoveries, video_discoveries, ingredients_discoveries)
 *   aggregated → completed   (product_aggregations)
 *   passed → completed       (bot_checks)  [keep passed as extra]
 *   failed → errors          (bot_checks, test_suite_runs)
 *
 * Adds missing columns:
 *   total       on: product_searches, product_discoveries, video_discoveries, ingredients_discoveries, test_suite_runs
 *   completed   on: bot_checks (rename from passed), test_suite_runs (rename from passed)
 *   errors      on: product_searches, product_discoveries, video_discoveries
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  // ── product_crawls: rename crawled → completed ──
  await db.execute(sql`ALTER TABLE "product_crawls" RENAME COLUMN "crawled" TO "completed"`)

  // ── product_searches: add total, rename discovered → completed, add errors ──
  await db.execute(sql`ALTER TABLE "product_searches" ADD COLUMN IF NOT EXISTS "total" numeric DEFAULT 0`)
  await db.execute(sql`ALTER TABLE "product_searches" RENAME COLUMN "discovered" TO "completed"`)
  await db.execute(sql`ALTER TABLE "product_searches" ADD COLUMN IF NOT EXISTS "errors" numeric DEFAULT 0`)

  // ── product_discoveries: add total, rename discovered → completed, add errors ──
  await db.execute(sql`ALTER TABLE "product_discoveries" ADD COLUMN IF NOT EXISTS "total" numeric DEFAULT 0`)
  await db.execute(sql`ALTER TABLE "product_discoveries" RENAME COLUMN "discovered" TO "completed"`)
  await db.execute(sql`ALTER TABLE "product_discoveries" ADD COLUMN IF NOT EXISTS "errors" numeric DEFAULT 0`)

  // ── product_aggregations: rename aggregated → completed ──
  await db.execute(sql`ALTER TABLE "product_aggregations" RENAME COLUMN "aggregated" TO "completed"`)

  // ── video_crawls: rename crawled → completed ──
  await db.execute(sql`ALTER TABLE "video_crawls" RENAME COLUMN "crawled" TO "completed"`)

  // ── video_discoveries: add total, rename discovered → completed, add errors ──
  await db.execute(sql`ALTER TABLE "video_discoveries" ADD COLUMN IF NOT EXISTS "total" numeric DEFAULT 0`)
  await db.execute(sql`ALTER TABLE "video_discoveries" RENAME COLUMN "discovered" TO "completed"`)
  await db.execute(sql`ALTER TABLE "video_discoveries" ADD COLUMN IF NOT EXISTS "errors" numeric DEFAULT 0`)

  // ── video_processings: already has total, completed, errors — no changes needed ──

  // ── ingredients_discoveries: add total, rename discovered → completed ──
  await db.execute(sql`ALTER TABLE "ingredients_discoveries" ADD COLUMN IF NOT EXISTS "total" numeric DEFAULT 0`)
  await db.execute(sql`ALTER TABLE "ingredients_discoveries" RENAME COLUMN "discovered" TO "completed"`)

  // ── ingredient_crawls: rename crawled → completed ──
  await db.execute(sql`ALTER TABLE "ingredient_crawls" RENAME COLUMN "crawled" TO "completed"`)

  // ── bot_checks: rename failed → errors, add completed (copy from passed) ──
  await db.execute(sql`ALTER TABLE "bot_checks" RENAME COLUMN "failed" TO "errors"`)
  await db.execute(sql`ALTER TABLE "bot_checks" ADD COLUMN IF NOT EXISTS "completed" numeric DEFAULT 0`)
  await db.execute(sql`UPDATE "bot_checks" SET "completed" = "passed"`)

  // ── test_suite_runs: rename failed → errors, rename passed → completed, add total ──
  await db.execute(sql`ALTER TABLE "test_suite_runs" RENAME COLUMN "failed" TO "errors"`)
  await db.execute(sql`ALTER TABLE "test_suite_runs" RENAME COLUMN "passed" TO "completed"`)
  await db.execute(sql`ALTER TABLE "test_suite_runs" ADD COLUMN IF NOT EXISTS "total" numeric DEFAULT 0`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // ── product_crawls ──
  await db.execute(sql`ALTER TABLE "product_crawls" RENAME COLUMN "completed" TO "crawled"`)

  // ── product_searches ──
  await db.execute(sql`ALTER TABLE "product_searches" RENAME COLUMN "completed" TO "discovered"`)
  await db.execute(sql`ALTER TABLE "product_searches" DROP COLUMN IF EXISTS "total"`)
  await db.execute(sql`ALTER TABLE "product_searches" DROP COLUMN IF EXISTS "errors"`)

  // ── product_discoveries ──
  await db.execute(sql`ALTER TABLE "product_discoveries" RENAME COLUMN "completed" TO "discovered"`)
  await db.execute(sql`ALTER TABLE "product_discoveries" DROP COLUMN IF EXISTS "total"`)
  await db.execute(sql`ALTER TABLE "product_discoveries" DROP COLUMN IF EXISTS "errors"`)

  // ── product_aggregations ──
  await db.execute(sql`ALTER TABLE "product_aggregations" RENAME COLUMN "completed" TO "aggregated"`)

  // ── video_crawls ──
  await db.execute(sql`ALTER TABLE "video_crawls" RENAME COLUMN "completed" TO "crawled"`)

  // ── video_discoveries ──
  await db.execute(sql`ALTER TABLE "video_discoveries" RENAME COLUMN "completed" TO "discovered"`)
  await db.execute(sql`ALTER TABLE "video_discoveries" DROP COLUMN IF EXISTS "total"`)
  await db.execute(sql`ALTER TABLE "video_discoveries" DROP COLUMN IF EXISTS "errors"`)

  // ── ingredients_discoveries ──
  await db.execute(sql`ALTER TABLE "ingredients_discoveries" RENAME COLUMN "completed" TO "discovered"`)
  await db.execute(sql`ALTER TABLE "ingredients_discoveries" DROP COLUMN IF EXISTS "total"`)

  // ── ingredient_crawls ──
  await db.execute(sql`ALTER TABLE "ingredient_crawls" RENAME COLUMN "completed" TO "crawled"`)

  // ── bot_checks ──
  await db.execute(sql`ALTER TABLE "bot_checks" DROP COLUMN IF EXISTS "completed"`)
  await db.execute(sql`ALTER TABLE "bot_checks" RENAME COLUMN "errors" TO "failed"`)

  // ── test_suite_runs ──
  await db.execute(sql`ALTER TABLE "test_suite_runs" DROP COLUMN IF EXISTS "total"`)
  await db.execute(sql`ALTER TABLE "test_suite_runs" RENAME COLUMN "completed" TO "passed"`)
  await db.execute(sql`ALTER TABLE "test_suite_runs" RENAME COLUMN "errors" TO "failed"`)
}
