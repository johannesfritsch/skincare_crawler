import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "test_suites_aggregations_ai_checks" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"question" varchar NOT NULL
  );
  
  ALTER TABLE "test_suites_aggregations" ADD COLUMN "ai_check_threshold" numeric DEFAULT 0.75;
  ALTER TABLE "test_suites_aggregations_ai_checks" ADD CONSTRAINT "test_suites_aggregations_ai_checks_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."test_suites_aggregations"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "test_suites_aggregations_ai_checks_order_idx" ON "test_suites_aggregations_ai_checks" USING btree ("_order");
  CREATE INDEX "test_suites_aggregations_ai_checks_parent_id_idx" ON "test_suites_aggregations_ai_checks" USING btree ("_parent_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "test_suites_aggregations_ai_checks" CASCADE;
  ALTER TABLE "test_suites_aggregations" DROP COLUMN "ai_check_threshold";`)
}
