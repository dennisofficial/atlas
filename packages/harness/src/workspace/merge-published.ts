import { ATLAS_GIT_IDENTITY, gitLines, gitMessageOf, gitOneLine } from './git-text'
import type { GitReader } from './snapshot'
import { runGit } from './run-git'

export type MergedWorkspace = { conflicts: readonly string[] }

const remoteNameOf = async (args: {
  read: GitReader
  cwd: string
}): Promise<string> => {
  const remotes = await args.read({ args: ['remote'], cwd: args.cwd })
  const names = remotes.ok ? gitLines(remotes) : []
  if (names.includes('origin')) return 'origin'
  const first = names[0]
  if (first === undefined) throw new Error('this repository has no remote to fetch home from')
  return first
}

/**
 * The merge machinery refuses to run over a dirty tree, so the operator's uncommitted state is
 * committed to a dangling commit first and HEAD is put back afterwards. The sandbox's baseline
 * rides as a second parent so it becomes the merge base: with the lifted commit as base, the
 * lifted work counts as an independent addition on both sides, and a cloud edit that merely
 * appends after a lifted line trips diff3's same-spot rule and conflicts (the e2e rig's leg 2
 * failed exactly this way until the baseline was pinned).
 */
export async function mergePublishedWorkspace(args: {
  cwd: string
  ref: string
  base: string | null
  git?: GitReader | undefined
}): Promise<MergedWorkspace> {
  const git = args.git ?? runGit
  const { cwd } = args

  const remote = await remoteNameOf({ read: git, cwd })
  const fetched = await git({ args: ['fetch', remote, args.ref], cwd })
  if (!fetched.ok) {
    throw new Error(`the workspace coming home would not fetch: ${gitMessageOf(fetched)}`)
  }

  const shared = gitOneLine(await git({ args: ['merge-base', 'HEAD', 'FETCH_HEAD'], cwd }))
  if (shared === null) {
    throw new Error(
      'the local checkout and the cloud workspace share no commit — the checkout has moved too far since the lift to merge them',
    )
  }
  if (args.base !== null) {
    const descends = await git({ args: ['merge-base', '--is-ancestor', args.base, 'FETCH_HEAD'], cwd })
    if (!descends.ok) {
      throw new Error(
        'the published workspace does not descend from the baseline the sandbox recorded — refusing to merge',
      )
    }
  }

  const home = gitOneLine(await git({ args: ['rev-parse', 'HEAD'], cwd }))
  if (home === null) throw new Error('this checkout has no commit to come home to')
  const branch = gitOneLine(await git({ args: ['symbolic-ref', '--quiet', '--short', 'HEAD'], cwd }))

  const staged = await git({ args: ['add', '-A'], cwd })
  if (!staged.ok) throw new Error(`the local tree would not stage: ${gitMessageOf(staged)}`)

  let detached = false
  const putHeadBack = async (): Promise<void> => {
    if (detached) {
      if (branch !== null) await git({ args: ['symbolic-ref', 'HEAD', `refs/heads/${branch}`], cwd })
      else await git({ args: ['update-ref', '--no-deref', 'HEAD', home], cwd })
      detached = false
    }
    await git({ args: ['reset'], cwd })
  }

  let result: MergedWorkspace
  try {
    const tree = gitOneLine(await git({ args: ['write-tree'], cwd }))
    if (tree === null) throw new Error('the local tree would not write')
    const parents = [home, ...(args.base === null ? [] : [args.base])]
    const local = gitOneLine(
      await git({
        args: [
          ...ATLAS_GIT_IDENTITY,
          'commit-tree',
          tree,
          ...parents.flatMap((parent) => ['-p', parent]),
          '-m',
          'atlas: local state at descend',
        ],
        cwd,
      }),
    )
    if (local === null) throw new Error('the local tree would not commit for the merge')
    const moved = await git({ args: ['checkout', '--detach', local], cwd })
    if (!moved.ok) throw new Error(`the merge could not set up: ${gitMessageOf(moved)}`)
    detached = true

    const merged = await git({
      args: [...ATLAS_GIT_IDENTITY, 'merge', '--squash', 'FETCH_HEAD'],
      cwd,
    })
    if (!merged.ok) {
      const conflicts = gitLines(await git({ args: ['diff', '--name-only', '--diff-filter=U'], cwd }))
      if (conflicts.length === 0) {
        throw new Error(`the workspace coming home would not merge: ${gitMessageOf(merged)}`)
      }
      result = { conflicts }
    } else {
      result = { conflicts: [] }
    }
  } finally {
    await putHeadBack()
  }

  await git({ args: ['push', remote, '--delete', args.ref], cwd })

  return result
}
