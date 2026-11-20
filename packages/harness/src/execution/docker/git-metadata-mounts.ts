import { isAbsolute } from 'node:path'

import { isUnderPath } from '@dltech/atlas-core'

import { EMountMode, type Mount } from '../image/mounts'

const gitDirectories = (worktree: string): readonly string[] => {
  try {
    const probe = Bun.spawnSync(
      ['git', 'rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'],
      { cwd: worktree, stdin: 'ignore', stderr: 'ignore' },
    )
    if (!probe.success) return []
    return [...new Set(probe.stdout.toString().trim().split('\n').filter(isAbsolute))]
  } catch {
    return []
  }
}

export function mountsWithGitMetadata(args: { worktree: string }): readonly Mount[] {
  const directories = gitDirectories(args.worktree).filter(
    (path) => !isUnderPath({ directory: args.worktree, path }),
  )
  const metadata = directories.filter(
    (path) =>
      !directories.some((directory) => directory !== path && isUnderPath({ directory, path })),
  )
  return metadata.map((path) => ({ path, mode: EMountMode.ReadWrite }))
}
