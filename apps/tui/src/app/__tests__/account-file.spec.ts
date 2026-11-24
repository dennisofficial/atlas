import { describe, expect, test } from 'bun:test'
import { mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  ACCOUNT_FILE_NAME,
  ACCOUNT_FILE_VERSION,
  accountHomeOf,
  accountPathOf,
  apiUrlOf,
  DEFAULT_API_URL,
  deleteAccount,
  parseAccount,
  readAccount,
  withLastSession,
  withPreferences,
  writeAccount,
  type AccountFile,
} from '../account/account-file'

const ACCOUNT: AccountFile = {
  version: ACCOUNT_FILE_VERSION,
  apiUrl: 'https://api.example.test',
  email: 'dennis@example.test',
  token: 'token-1',
  preferences: { accent: 'amber' },
  lastSessionId: null,
}

const tempHome = (): string => mkdtempSync(join(tmpdir(), 'atlas-account-'))

const modeOf = (path: string): number => statSync(path).mode & 0o777

describe('account file', () => {
  test('round trips through disk with owner-only mode', () => {
    const path = join(tempHome(), ACCOUNT_FILE_NAME)
    writeAccount({ path, account: ACCOUNT })

    expect(modeOf(path)).toBe(0o600)
    expect(readAccount({ path })).toEqual(ACCOUNT)
  })

  test('tightens a file that was written with a looser mode', () => {
    const path = join(tempHome(), ACCOUNT_FILE_NAME)
    writeFileSync(path, JSON.stringify(ACCOUNT), { mode: 0o644 })

    writeAccount({ path, account: { ...ACCOUNT, token: 'token-2' } })

    expect(modeOf(path)).toBe(0o600)
    expect(readAccount({ path })?.token).toBe('token-2')
  })

  test('deleteAccount is idempotent', () => {
    const path = join(tempHome(), ACCOUNT_FILE_NAME)
    writeAccount({ path, account: ACCOUNT })

    deleteAccount({ path })
    expect(readAccount({ path })).toBeNull()
    expect(() => deleteAccount({ path })).not.toThrow()
  })

  test('parseAccount rejects what it cannot trust', () => {
    expect(parseAccount('not json at all')).toBeNull()
    expect(parseAccount(JSON.stringify({ ...ACCOUNT, version: 2 }))).toBeNull()
    expect(parseAccount(JSON.stringify({ ...ACCOUNT, token: '' }))).toBeNull()
    expect(parseAccount(JSON.stringify({ ...ACCOUNT, token: undefined }))).toBeNull()
    expect(parseAccount(JSON.stringify([]))).toBeNull()
  })

  test('parseAccount accepts a null email and fills empty preferences', () => {
    expect(
      parseAccount(JSON.stringify({ ...ACCOUNT, email: null, preferences: undefined })),
    ).toEqual({ ...ACCOUNT, email: null, preferences: {} })
  })

  test('parseAccount carries the last open session and defaults it to null', () => {
    expect(parseAccount(JSON.stringify({ ...ACCOUNT, lastSessionId: 'session-b' }))).toEqual({
      ...ACCOUNT,
      lastSessionId: 'session-b',
    })
    expect(
      parseAccount(JSON.stringify({ ...ACCOUNT, lastSessionId: undefined }))?.lastSessionId,
    ).toBe(null)
    expect(parseAccount(JSON.stringify({ ...ACCOUNT, lastSessionId: 7 }))).toBeNull()
  })
})

describe('withLastSession', () => {
  test('replaces the last open session and keeps the rest of the account', () => {
    expect(withLastSession({ account: ACCOUNT, sessionId: 'session-b' })).toEqual({
      ...ACCOUNT,
      lastSessionId: 'session-b',
    })
    expect(ACCOUNT.lastSessionId).toBeNull()
  })
})

describe('withPreferences', () => {
  test('replaces the preferences and keeps the token, email and api url', () => {
    const next = withPreferences({
      account: ACCOUNT,
      preferences: { 'appearance.accent': 'moss' },
    })

    expect(next).toEqual({
      version: ACCOUNT_FILE_VERSION,
      apiUrl: ACCOUNT.apiUrl,
      email: ACCOUNT.email,
      token: ACCOUNT.token,
      preferences: { 'appearance.accent': 'moss' },
      lastSessionId: null,
    })
    expect(ACCOUNT.preferences).toEqual({ accent: 'amber' })
  })
})

describe('account paths', () => {
  test('apiUrlOf prefers ATLAS_API_URL and strips trailing slashes', () => {
    expect(apiUrlOf({ env: { ATLAS_API_URL: 'https://staging.example.test//' } })).toBe(
      'https://staging.example.test',
    )
    expect(apiUrlOf({ env: {} })).toBe(DEFAULT_API_URL)
    expect(apiUrlOf({ env: { ATLAS_API_URL: '' } })).toBe(DEFAULT_API_URL)
  })

  test('accountPathOf prefers ATLAS_HOME over the home directory', () => {
    const home = tempHome()
    expect(accountHomeOf({ env: { ATLAS_HOME: '/tmp/asked-home' }, home })).toBe('/tmp/asked-home')
    expect(accountPathOf({ env: { ATLAS_HOME: '/tmp/asked-home' }, home })).toBe(
      '/tmp/asked-home/account.json',
    )
    expect(accountPathOf({ env: {}, home })).toBe(join(home, '.atlas', ACCOUNT_FILE_NAME))
  })
})
