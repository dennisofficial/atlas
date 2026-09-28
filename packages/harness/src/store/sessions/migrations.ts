import { readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { LogPort } from '@dltech/atlas-core'

import { logFieldsOf } from '../logs'
import { SESSION_FORMAT_VERSION } from './meta'
import { sessionMetaFile, threadsDirectory } from './paths'

export type SessionMigrationContext = {
  sessionDir: string
  readSessionMeta: () => Record<string, unknown> | undefined
  readThreadMetas: () => { file: string; meta: Record<string, unknown> }[]
  readLines: (args: { file: string }) => unknown[]
  writeLines: (args: { file: string; lines: unknown[] }) => void
  stampFormat: (args: { format: number }) => void
}

export type SessionMigration = {
  from: number
  to: number
  migrate: (context: SessionMigrationContext) => void
}

const SESSION_MIGRATIONS: readonly SessionMigration[] = []

function migrationPath(): SessionMigration[] {
  const steps: SessionMigration[] = []
  for (let from = 1; ; from += 1) {
    const step = SESSION_MIGRATIONS.find((migration) => migration.from === from)
    if (step === undefined) break
    steps.push(step)
  }
  return steps
}

export function canMigrateToCurrent({ format }: { format: number }): boolean {
  if (format === SESSION_FORMAT_VERSION) return true
  if (format > SESSION_FORMAT_VERSION) return false
  let at = format
  for (const step of migrationPath()) {
    if (step.from !== at) continue
    at = step.to
  }
  return at === SESSION_FORMAT_VERSION
}

export function migrateSessionDirectory({
  sessionDir,
  from,
  logPort,
}: {
  sessionDir: string
  from: number
  logPort?: LogPort | undefined
}): number {
  const pending = migrationPath().filter((migration) => migration.from >= from)
  if (pending.length === 0) return from
  const context = migrationContext({ sessionDir, logPort })
  let at = from
  for (const step of pending) {
    step.migrate(context)
    at = step.to
    context.stampFormat({ format: at })
  }
  return at
}

function migrationContext({
  sessionDir,
  logPort,
}: {
  sessionDir: string
  logPort?: LogPort | undefined
}): SessionMigrationContext {
  const metaFile = sessionMetaFile({ sessionDir })
  return {
    sessionDir,
    readSessionMeta: () => readJsonSync({ file: metaFile, logPort }),
    readThreadMetas: () =>
      readdirSync(threadsDirectory({ sessionDir }))
        .filter((name) => name.endsWith('.meta.json'))
        .flatMap((name) => {
          const file = join(threadsDirectory({ sessionDir }), name)
          const meta = readJsonSync({ file, logPort })
          return meta === undefined ? [] : [{ file, meta }]
        }),
    readLines: ({ file }) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as unknown),
    writeLines: ({ file, lines }) => {
      const text = lines.length === 0 ? '' : `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`
      writeFileAtomicSync({ file, text })
    },
    stampFormat: ({ format }) => {
      const meta = readJsonSync({ file: metaFile, logPort })
      if (meta === undefined) return
      writeFileAtomicSync({ file: metaFile, text: JSON.stringify({ ...meta, format }, null, 2) })
    },
  }
}

function readJsonSync({
  file,
  logPort,
}: {
  file: string
  logPort?: LogPort | undefined
}): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  } catch (error) {
    logPort?.warn({
      source: 'store.migrations',
      message: 'a session meta file could not be read during migration',
      data: { file },
      ...logFieldsOf({ error }),
    })
    return undefined
  }
}

function writeFileAtomicSync({ file, text }: { file: string; text: string }): void {
  const tmp = `${file}.${process.pid}.migrate.tmp`
  writeFileSync(tmp, text)
  renameSync(tmp, file)
}
