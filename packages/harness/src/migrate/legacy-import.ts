import { stat } from 'node:fs/promises'
import { join } from 'node:path'

import { SESSIONS_DIRECTORY_NAME } from '../store/sessions/paths'

export const LEGACY_DATABASE_NAME = 'harness.db'

export const LEGACY_IMPORT_MARKER_NAME = '.imported-from-harness-db'

export const EXPORT_HARNESS_DB_COMMAND = 'export-harness-db'

export async function legacyImportPending(args: { home: string }): Promise<boolean> {
  const database = await stat(join(args.home, LEGACY_DATABASE_NAME)).catch(() => null)
  if (database === null || !database.isFile()) return false

  const marker = await stat(join(args.home, SESSIONS_DIRECTORY_NAME, LEGACY_IMPORT_MARKER_NAME)).catch(() => null)
  return marker === null
}

export function legacyImportCommandLine(args: { home: string; command: string }): string {
  return `${args.command} ${EXPORT_HARNESS_DB_COMMAND} --db ${join(args.home, LEGACY_DATABASE_NAME)} --home ${args.home}`
}

export function legacyImportNoticeText(args: { home: string; command: string }): string {
  return `Your pre-1.0 sessions are still in ${join(args.home, LEGACY_DATABASE_NAME)} — /resume cannot list them until you import them. Run: ${legacyImportCommandLine(args)} — the old database is left untouched as a backup.`
}
