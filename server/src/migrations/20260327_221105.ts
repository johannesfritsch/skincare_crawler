import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "source_variants" ADD COLUMN "pzn" varchar;
  CREATE INDEX "source_variants_pzn_idx" ON "source_variants" USING btree ("pzn");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "source_variants_pzn_idx";
  ALTER TABLE "source_variants" DROP COLUMN "pzn";`)
}
