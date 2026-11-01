import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  WORKTREE_FILE_PATH,
  readWorktreeFilesDocument,
  type WorktreeFilesConfig,
} from '@dltech/atlas-core'

export const WORKTREE_FILE = WORKTREE_FILE_PATH.join('/')

export enum EWorktreeFilesLoad {
  Absent = 'absent',
  Invalid = 'invalid',
  Loaded = 'loaded',
}

export type WorktreeFilesLoad =
  | { load: EWorktreeFilesLoad.Absent }
  | { load: EWorktreeFilesLoad.Invalid; error: string }
  | { load: EWorktreeFilesLoad.Loaded; config: WorktreeFilesConfig }

const detailOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const isAbsent = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'

export function parseWorktreeFiles({ text }: { text: string }): WorktreeFilesLoad {
  let document: unknown
  try {
    document = Bun.YAML.parse(text)
  } catch (error) {
    return { load: EWorktreeFilesLoad.Invalid, error: `not valid YAML (${detailOf(error)})` }
  }

  const read = readWorktreeFilesDocument(document)
  if (!read.ok) return { load: EWorktreeFilesLoad.Invalid, error: read.error }
  return { load: EWorktreeFilesLoad.Loaded, config: read.config }
}

export async function loadWorktreeFiles({ root }: { root: string }): Promise<WorktreeFilesLoad> {
  let text: string
  try {
    text = await readFile(join(root, ...WORKTREE_FILE_PATH), 'utf8')
  } catch (error) {
    if (isAbsent(error)) return { load: EWorktreeFilesLoad.Absent }
    return { load: EWorktreeFilesLoad.Invalid, error: `unreadable (${detailOf(error)})` }
  }
  return parseWorktreeFiles({ text })
}
