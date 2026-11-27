import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const TOKEN_FILE_MODE = 0o600

export type StoredTunnel = { tunnelToken: string; revision: number; updatedAt: string }

export const tokenFileOf = (home: string): string => `${home}/previews.json`

export const readStored = (file: string): StoredTunnel | undefined => {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const { tunnelToken, revision, updatedAt } = parsed as Record<string, unknown>
  if (typeof tunnelToken !== 'string' || tunnelToken === '') return undefined
  return {
    tunnelToken,
    revision: typeof revision === 'number' ? revision : 0,
    updatedAt: typeof updatedAt === 'string' ? updatedAt : new Date(0).toISOString(),
  }
}

export const writeStored = (args: { file: string; stored: StoredTunnel }): void => {
  mkdirSync(dirname(args.file), { recursive: true })
  const temporary = `${args.file}.tmp`
  writeFileSync(temporary, `${JSON.stringify(args.stored)}\n`, { mode: TOKEN_FILE_MODE })
  chmodSync(temporary, TOKEN_FILE_MODE)
  renameSync(temporary, args.file)
}
