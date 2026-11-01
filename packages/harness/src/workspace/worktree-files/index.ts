import { EWorktreeFilesState, describeWorktreeFiles } from '@dltech/atlas-core'

import { applyWorktreeFiles } from './apply'
import { WORKTREE_FILE } from './load'

const detailOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export async function worktreeFilesReport({
  source,
  worktree,
}: {
  source: string
  worktree: string
}): Promise<string | undefined> {
  try {
    return describeWorktreeFiles(await applyWorktreeFiles({ source, worktree }))
  } catch (error) {
    return describeWorktreeFiles({
      state: EWorktreeFilesState.Invalid,
      file: WORKTREE_FILE,
      error: detailOf(error),
    })
  }
}
