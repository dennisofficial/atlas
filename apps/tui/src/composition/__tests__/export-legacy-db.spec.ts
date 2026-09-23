import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Database } from 'bun:sqlite'

import { EExportLegacyDbTask, exportLegacyDbRequestOf, runExportLegacyDb } from '../export-legacy-db'

const homes: string[] = []

function openHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'atlas-export-legacy-db-'))
  homes.push(home)
  return home
}

afterEach(() => {
  while (homes.length > 0) {
    const home = homes.pop()
    if (home !== undefined) rmSync(home, { recursive: true, force: true })
  }
})

describe('exportLegacyDbRequestOf', () => {
  it('ignores argv that does not start with the command', () => {
    expect(exportLegacyDbRequestOf({ argv: [], home: '/home' })).toBeUndefined()
    expect(exportLegacyDbRequestOf({ argv: ['--resume', 'x'], home: '/home' })).toBeUndefined()
  })

  it('defaults db and home to the operator atlas home', () => {
    const request = exportLegacyDbRequestOf({ argv: ['export-harness-db'], home: '/op/.atlas' })

    expect(request).toEqual({
      task: EExportLegacyDbTask.Run,
      db: '/op/.atlas/harness.db',
      home: '/op/.atlas',
    })
  })

  it('takes explicit --db and --home paths', () => {
    const request = exportLegacyDbRequestOf({
      argv: ['export-harness-db', '--db', '/tmp/old.db', '--home', '/tmp/target'],
      home: '/op/.atlas',
    })

    expect(request).toEqual({
      task: EExportLegacyDbTask.Run,
      db: '/tmp/old.db',
      home: '/tmp/target',
    })
  })

  it('shows usage on --help', () => {
    const request = exportLegacyDbRequestOf({ argv: ['export-harness-db', '--help'], home: '/home' })

    expect(request).toEqual({ task: EExportLegacyDbTask.Usage, complaint: undefined })
  })

  it('complains about unrecognized arguments', () => {
    const request = exportLegacyDbRequestOf({
      argv: ['export-harness-db', '--nope'],
      home: '/home',
    })

    expect(request?.task).toBe(EExportLegacyDbTask.Usage)
    expect(request?.task === EExportLegacyDbTask.Usage ? request.complaint : undefined).toContain(
      '--nope',
    )
  })
})

describe('runExportLegacyDb', () => {
  it('refuses when the database file does not exist', async () => {
    const home = openHome()
    const written: string[] = []
    const spy = spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      written.push(String(chunk))
      return true
    })

    try {
      const code = await runExportLegacyDb({
        request: { task: EExportLegacyDbTask.Run, db: join(home, 'harness.db'), home },
      })

      expect(code).toBe(1)
      expect(written.join('')).toContain('nothing to import')
    } finally {
      spy.mockRestore()
    }
  })

  it('exports a real database into the target home and prints the summary', async () => {
    const home = openHome()
    const db = join(home, 'harness.db')
    const database = new Database(db, { create: true })
    database.run('CREATE TABLE "Thread" ("id" TEXT NOT NULL PRIMARY KEY)')
    database.run('CREATE TABLE "Event" ("id" TEXT NOT NULL PRIMARY KEY)')
    database.run('CREATE TABLE "Turn" ("runId" TEXT NOT NULL PRIMARY KEY)')
    database.close()

    const written: string[] = []
    const spy = spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      written.push(String(chunk))
      return true
    })

    try {
      const code = await runExportLegacyDb({
        request: { task: EExportLegacyDbTask.Run, db, home },
      })

      expect(code).toBe(0)
      const output = written.join('')
      expect(output).toContain('export complete')
      expect(output).toContain('sessions:')
      expect(existsSync(join(home, 'sessions', '.imported-from-harness-db'))).toBe(true)
    } finally {
      spy.mockRestore()
    }
  })
})
