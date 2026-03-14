import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_products_score_history_creator_score_change" AS ENUM('drop', 'stable', 'increase');
  ALTER TYPE "public"."enum_products_score_history_change" RENAME TO "enum_products_score_history_store_score_change";
  ALTER TABLE "products_score_history" RENAME COLUMN "change" TO "store_score_change";
  ALTER TABLE "products_score_history" ADD COLUMN "creator_score_change" "enum_products_score_history_creator_score_change";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_products_score_history_change" AS ENUM('drop', 'stable', 'increase');
  ALTER TABLE "products_score_history" RENAME COLUMN "store_score_change" TO "change";
  ALTER TABLE "products_score_history" DROP COLUMN "creator_score_change";
  DROP TYPE "public"."enum_products_score_history_store_score_change";
  DROP TYPE "public"."enum_products_score_history_creator_score_change";`)
}
