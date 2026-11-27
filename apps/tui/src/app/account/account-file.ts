import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { ATLAS_DIRECTORY_NAME } from '@dltech/atlas-core'

export const ACCOUNT_FILE_NAME = 'account.json'

export const ACCOUNT_FILE_VERSION = 1

export const DEFAULT_API_URL = 'https://api.byatlas.io'

export const DEFAULT_WEB_ORIGIN = 'https://byatlas.io'

const FILE_MODE = 0o600

export type AccountFile = {
  version: number
  apiUrl: string
  email: string | null
  token: string
  preferences: Record<string, unknown>
  lastSessionId?: string | null
}

const asked = (value: string | undefined): string | null =>
  value === undefined || value === '' ? null : value

const stripTrailingSlashes = (url: string): string => url.replace(/\/+$/, '')

export const apiUrlOf = (args: { env: Record<string, string | undefined> }): string =>
  stripTrailingSlashes(asked(args.env.ATLAS_API_URL) ?? DEFAULT_API_URL)

export const webOriginOf = (args: { env: Record<string, string | undefined> }): string =>
  stripTrailingSlashes(asked(args.env.ATLAS_WEB_ORIGIN) ?? DEFAULT_WEB_ORIGIN)

export const accountHomeOf = (args: {
  env: Record<string, string | undefined>
  home: string
}): string => asked(args.env.ATLAS_HOME) ?? join(args.home, ATLAS_DIRECTORY_NAME)

export const accountPathOf = (args: {
  env: Record<string, string | undefined>
  home: string
}): string => join(accountHomeOf(args), ACCOUNT_FILE_NAME)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const parseAccount = (raw: string): AccountFile | null => {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (!isRecord(parsed)) return null

  const { version, apiUrl, email, token, preferences, lastSessionId } = parsed
  if (version !== ACCOUNT_FILE_VERSION) return null
  if (typeof apiUrl !== 'string' || apiUrl === '') return null
  if (typeof token !== 'string' || token === '') return null
  if (email !== null && typeof email !== 'string') return null
  if (lastSessionId !== undefined && lastSessionId !== null && typeof lastSessionId !== 'string')
    return null

  return {
    version: ACCOUNT_FILE_VERSION,
    apiUrl,
    email,
    token,
    preferences: isRecord(preferences) ? preferences : {},
    lastSessionId: asked(lastSessionId ?? undefined),
  }
}

export const readAccount = (args: { path: string }): AccountFile | null => {
  let raw: string
  try {
    raw = readFileSync(args.path, 'utf8')
  } catch {
    return null
  }

  return parseAccount(raw)
}

export const writeAccount = (args: { path: string; account: AccountFile }): void => {
  mkdirSync(dirname(args.path), { recursive: true })
  writeFileSync(args.path, `${JSON.stringify(args.account, null, 2)}\n`, { mode: FILE_MODE })
  chmodSync(args.path, FILE_MODE)
}

export const deleteAccount = (args: { path: string }): void => {
  rmSync(args.path, { force: true })
}

export const withPreferences = (args: {
  account: AccountFile
  preferences: Record<string, unknown>
}): AccountFile => ({ ...args.account, preferences: args.preferences })

export const withLastSession = (args: {
  account: AccountFile
  sessionId: string | null
}): AccountFile => ({ ...args.account, lastSessionId: args.sessionId })
