import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * No-op migration — snapshot alignment only.
 * The column renames (crawled→completed, discovered→completed, etc.) and
 * new columns (total, errors) were already applied by migration 20260412_075923.
 * This migration exists only to update the JSON snapshot baseline.
 */
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  // Already applied by 20260412_075923
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  // No-op
}
