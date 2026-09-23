import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { legacyImportNoticeText, legacyImportPending } from '../legacy-import'

const homes: string[] = []

function openHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'atlas-legacy-import-'))
  homes.push(home)
  return home
}

afterEach(() => {
  while (homes.length > 0) {
    const home = homes.pop()
    if (home !== undefined) rmSync(home, { recursive: true, force: true })
  }
})

describe('legacyImportPending', () => {
  it('is false when no harness.db exists', async () => {
    expect(await legacyImportPending({ home: openHome() })).toBe(false)
  })

  it('is true when harness.db exists and no sessions directory has been created', async () => {
    const home = openHome()
    writeFileSync(join(home, 'harness.db'), '')

    expect(await legacyImportPending({ home })).toBe(true)
  })

  it('is true when harness.db exists and the sessions directory is still empty', async () => {
    const home = openHome()
    writeFileSync(join(home, 'harness.db'), '')
    mkdirSync(join(home, 'sessions'))

    expect(await legacyImportPending({ home })).toBe(true)
  })

  it('stays true after ordinary conversations exist, until the export marker lands', async () => {
    const home = openHome()
    writeFileSync(join(home, 'harness.db'), '')
    mkdirSync(join(home, 'sessions', 'session-1'), { recursive: true })

    expect(await legacyImportPending({ home })).toBe(true)
  })

  it('is false once the export has written its marker', async () => {
    const home = openHome()
    writeFileSync(join(home, 'harness.db'), '')
    mkdirSync(join(home, 'sessions'), { recursive: true })
    writeFileSync(join(home, 'sessions', '.imported-from-harness-db'), '{}')

    expect(await legacyImportPending({ home })).toBe(false)
  })

  it('is false when harness.db is a directory rather than a database file', async () => {
    const home = openHome()
    mkdirSync(join(home, 'harness.db'))

    expect(await legacyImportPending({ home })).toBe(false)
  })
})

describe('legacyImportNoticeText', () => {
  it('names the database, the exact import command, and the backup behavior', () => {
    const text = legacyImportNoticeText({ home: '/Users/op/.atlas', command: 'atlas' })

    expect(text).toContain('/Users/op/.atlas/harness.db')
    expect(text).toContain(
      'atlas export-harness-db --db /Users/op/.atlas/harness.db --home /Users/op/.atlas',
    )
    expect(text).toContain('untouched')
  })

  it('uses the dev command when launched from source', () => {
    const text = legacyImportNoticeText({ home: '/repo/.atlas-home', command: 'atlas-dev' })

    expect(text).toContain('atlas-dev export-harness-db')
  })
})
