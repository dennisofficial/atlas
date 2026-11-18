import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'

import { normalizeRepoOrigin } from '@dltech/atlas-core'

const realOf = (path: string): string => {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

export const changeCheckoutId = (args: { repo: string; worktreePath: string }): string =>
  createHash('sha256')
    .update(`${args.repo}\n${realOf(args.worktreePath)}`)
    .digest('hex')

export const changeRepoOf = (args: { originUrl: string; repoPath: string }): string =>
  normalizeRepoOrigin(args.originUrl) ?? args.repoPath
