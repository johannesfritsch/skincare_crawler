import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TABLE "work_items" (
      "id" serial PRIMARY KEY NOT NULL,
      "job_collection" text NOT NULL,
      "job_id" integer NOT NULL,
      "item_key" text NOT NULL,
      "stage_name" text NOT NULL,
      "status" text NOT NULL DEFAULT 'pending',
      "claimed_by" integer,
      "claimed_at" timestamp(3) with time zone,
      "completed_at" timestamp(3) with time zone,
      "error" text,
      "result_data" jsonb,
      "retry_count" integer NOT NULL DEFAULT 0,
      "max_retries" integer NOT NULL DEFAULT 3,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "work_items_job_item_stage_unique"
        UNIQUE("job_collection", "job_id", "item_key", "stage_name")
    );

    CREATE INDEX "idx_work_items_claimable"
      ON "work_items" ("job_collection", "job_id")
      WHERE "status" = 'pending';

    CREATE INDEX "idx_work_items_stale"
      ON "work_items" ("claimed_at")
      WHERE "status" = 'claimed';

    CREATE INDEX "idx_work_items_job"
      ON "work_items" ("job_collection", "job_id");
  `)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TABLE IF EXISTS "work_items";
  `)
}
