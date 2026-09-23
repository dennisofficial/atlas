import { stat } from 'node:fs/promises'
import { join } from 'node:path'

import {
  EXPORT_HARNESS_DB_COMMAND,
  exportHarnessDb,
  LEGACY_DATABASE_NAME,
  messageOf,
} from '@dltech/atlas-harness'

const REFUSED = 1

const OK = 0

export enum EExportLegacyDbTask {
  Run = 'run',
  Usage = 'usage',
}

export type ExportLegacyDbRequest =
  | { task: EExportLegacyDbTask.Run; db: string; home: string }
  | { task: EExportLegacyDbTask.Usage; complaint: string | undefined }

const HELP_FLAGS: readonly string[] = ['--help', '-h']

export const EXPORT_LEGACY_DB_USAGE: readonly string[] = [
  `atlas ${EXPORT_HARNESS_DB_COMMAND} [--db <path-to-harness.db>] [--home <target-atlas-home>]`,
  '    imports pre-1.0 sessions from harness.db into <home>/sessions as per-session JSONL.',
  '    both flags default to the operator atlas home; the old database is left untouched.',
]

const valueAfter = ({
  argv,
  flag,
}: {
  argv: readonly string[]
  flag: string
}): string | undefined => {
  const at = argv.indexOf(flag)
  if (at < 0) return undefined

  const named = argv[at + 1]
  return named === undefined || named.startsWith('-') ? undefined : named
}

export function exportLegacyDbRequestOf({
  argv,
  home,
}: {
  argv: readonly string[]
  home: string
}): ExportLegacyDbRequest | undefined {
  if (argv[0] !== EXPORT_HARNESS_DB_COMMAND) return undefined
  if (argv.some((arg) => HELP_FLAGS.includes(arg))) {
    return { task: EExportLegacyDbTask.Usage, complaint: undefined }
  }

  const known = new Set([EXPORT_HARNESS_DB_COMMAND, '--db', '--home'])
  const stray = argv.find(
    (arg, index) => arg.startsWith('-') && !known.has(arg) && argv[index - 1] !== '--db' && argv[index - 1] !== '--home',
  )
  if (stray !== undefined) {
    return { task: EExportLegacyDbTask.Usage, complaint: `unrecognized argument: ${stray}` }
  }

  for (const flag of ['--db', '--home']) {
    if (argv.includes(flag) && valueAfter({ argv, flag }) === undefined) {
      return { task: EExportLegacyDbTask.Usage, complaint: `${flag} needs a path` }
    }
  }

  const target = valueAfter({ argv, flag: '--home' }) ?? home
  return {
    task: EExportLegacyDbTask.Run,
    db: valueAfter({ argv, flag: '--db' }) ?? join(target, LEGACY_DATABASE_NAME),
    home: target,
  }
}

const say = (lines: readonly string[]): void => {
  process.stdout.write(`${lines.join('\n')}\n`)
}

const complain = (line: string): void => {
  process.stderr.write(`${line}\n`)
}

export async function runExportLegacyDb({
  request,
}: {
  request: ExportLegacyDbRequest
}): Promise<number> {
  if (request.task === EExportLegacyDbTask.Usage) {
    if (request.complaint !== undefined) complain(request.complaint)
    say(EXPORT_LEGACY_DB_USAGE)
    return request.complaint === undefined ? OK : REFUSED
  }

  const database = await stat(request.db).catch(() => null)
  if (database === null || !database.isFile()) {
    complain(`no harness.db at ${request.db} — nothing to import.`)
    return REFUSED
  }

  try {
    const summary = await exportHarnessDb({ databaseUrl: `file:${request.db}`, home: request.home })
    say([
      `export complete: ${request.db} -> ${request.home}/sessions`,
      `  sessions:         ${summary.sessions}`,
      `  threads:          ${summary.threads}`,
      `  events:           ${summary.events}`,
      `  turns:            ${summary.turns}`,
      `  malformed bodies: ${summary.malformedBodies}`,
      `  orphaned agents:  ${summary.orphanedAgents}`,
      `the old database at ${request.db} is left untouched as a backup.`,
    ])
    return OK
  } catch (error: unknown) {
    complain(`export failed: ${messageOf(error)}`)
    return REFUSED
  }
}
