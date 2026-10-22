import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { restoreArchivedLocalFiles } from '../local-recovery'

let directory: string

const realAtlasHome = process.env['ATLAS_HOME']

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'atlas-local-recovery-'))
  process.env['ATLAS_HOME'] = directory
})

afterEach(() => {
  if (realAtlasHome === undefined) delete process.env['ATLAS_HOME']
  else process.env['ATLAS_HOME'] = realAtlasHome
  rmSync(directory, { recursive: true, force: true })
})

describe('restoreArchivedLocalFiles', () => {
  it('moves each archived file back when no live file sits at its path', () => {
    writeFileSync(join(directory, 'auth.json.archived'), '{"version":1,"accounts":["old"]}')
    writeFileSync(join(directory, 'secrets.json.archived'), 'enc')
    writeFileSync(join(directory, 'mcp.json.archived'), '{}')

    const restored = restoreArchivedLocalFiles()

    expect(restored).toEqual([
      join(directory, 'auth.json'),
      join(directory, 'secrets.json'),
      join(directory, 'mcp.json'),
    ])
    expect(readFileSync(join(directory, 'auth.json'), 'utf8')).toBe('{"version":1,"accounts":["old"]}')
    expect(existsSync(join(directory, 'auth.json.archived'))).toBe(false)
  })

  it('never overwrites a live file with its archived sibling', () => {
    writeFileSync(join(directory, 'auth.json'), '{"version":1,"accounts":["fresh"]}')
    writeFileSync(join(directory, 'auth.json.archived'), '{"version":1,"accounts":["old"]}')

    const restored = restoreArchivedLocalFiles()

    expect(restored).toEqual([])
    expect(readFileSync(join(directory, 'auth.json'), 'utf8')).toBe('{"version":1,"accounts":["fresh"]}')
    expect(existsSync(join(directory, 'auth.json.archived'))).toBe(true)
  })

  it('returns an empty list when nothing was archived', () => {
    expect(restoreArchivedLocalFiles()).toEqual([])
  })
})
