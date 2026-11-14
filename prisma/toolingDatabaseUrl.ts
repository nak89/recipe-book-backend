import 'dotenv/config'
import { parse } from 'dotenv'
import { readFileSync } from 'node:fs'

export function toolingDatabaseUrl() {
  if (process.env.MIGRATION_DATABASE_URL) return process.env.MIGRATION_DATABASE_URL
  try {
    const values = parse(readFileSync(new URL('../.env.migrations.local', import.meta.url)))
    return values.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return process.env.DATABASE_URL
  }
}
