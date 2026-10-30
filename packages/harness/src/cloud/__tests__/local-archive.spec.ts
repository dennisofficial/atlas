import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { fileLocalArchive } from '../local-archive'
import { restoreArchivedLocalFiles } from '../local-recovery'

let directory: string
const realAtlasHome = process.env['ATLAS_HOME']

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'atlas-local-archive-'))
  process.env['ATLAS_HOME'] = directory
})

afterEach(() => {
  if (realAtlasHome === undefined) delete process.env['ATLAS_HOME']
  else process.env['ATLAS_HOME'] = realAtlasHome
  rmSync(directory, { recursive: true, force: true })
})

const vault = (ids: string[], active: Record<string, string> = {}) => ({
  version: 2,
  accounts: ids.map((id) => ({ id, secret: `sealed-${id}` })),
  active,
})

const readJson = (name: string): unknown => JSON.parse(readFileSync(join(directory, name), 'utf8'))

describe('the local archive', () => {
  it('moves only the named accounts and secrets, then restores them on sign-out', () => {
    writeFileSync(
      join(directory, 'auth.json'),
      JSON.stringify(
        vault(['acc_login', 'acc_env'], {
          anthropic: 'acc_login',
          openai: 'acc_env',
        }),
      ),
    )
    writeFileSync(
      join(directory, 'secrets.json'),
      JSON.stringify({
        version: 1,
        secrets: { 'search.tavily': 'a', 'sandbox-serve:t': 'b' },
      }),
    )

    fileLocalArchive().archiveAccounts(['acc_login'])
    fileLocalArchive().archiveSecrets(['search.tavily'])

    expect(readJson('auth.json')).toEqual(vault(['acc_env'], { openai: 'acc_env' }))
    expect(readJson('auth.json.archived')).toEqual(vault(['acc_login'], { anthropic: 'acc_login' }))
    expect(readJson('secrets.json')).toEqual({
      version: 1,
      secrets: { 'sandbox-serve:t': 'b' },
    })

    restoreArchivedLocalFiles()

    expect(readJson('auth.json')).toEqual(
      vault(['acc_env', 'acc_login'], {
        openai: 'acc_env',
        anthropic: 'acc_login',
      }),
    )
    expect(existsSync(join(directory, 'auth.json.archived'))).toBe(false)
    expect(readJson('secrets.json')).toEqual({
      version: 1,
      secrets: { 'sandbox-serve:t': 'b', 'search.tavily': 'a' },
    })
  })

  it('accumulates repeated archives instead of overwriting the earlier one', () => {
    writeFileSync(join(directory, 'auth.json'), JSON.stringify(vault(['acc_1'])))
    fileLocalArchive().archiveAccounts(['acc_1'])
    writeFileSync(join(directory, 'auth.json'), JSON.stringify(vault(['acc_2'])))
    fileLocalArchive().archiveAccounts(['acc_2'])

    expect(readJson('auth.json.archived')).toEqual(vault(['acc_1', 'acc_2']))
  })
})
