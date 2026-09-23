import { CLOUD_WORKSPACE_PATH } from '@dltech/atlas-core'

import { ATLAS_GIT_IDENTITY, gitLines, gitMessageOf, gitOneLine } from './git-text'
import type { GitReader } from './snapshot'
import { runGit } from './run-git'

export type SupersededBranch = { branch: string; localTip: string; originTip: string }

export type MergedWorkspace = {
  conflicts: readonly string[]
  superseded?: SupersededBranch | undefined
}

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

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

const commitPresent = async (args: {
  git: GitReader
  cwd: string
  commit: string
}): Promise<boolean> =>
  (await args.git({ args: ['cat-file', '-e', `${args.commit}^{commit}`], cwd: args.cwd })).ok

const baseTreeOf = async (args: {
  git: GitReader
  cwd: string
  remote: string
  ref: string
  base: string | null
  baseTree: string | null
}): Promise<string> => {
  if (args.baseTree !== null) return args.baseTree
  if (args.base === null) return EMPTY_TREE

  if (!(await commitPresent({ git: args.git, cwd: args.cwd, commit: args.base }))) {
    await args.git({ args: ['fetch', args.remote, args.base], cwd: args.cwd })
  }
  if (!(await commitPresent({ git: args.git, cwd: args.cwd, commit: args.base }))) {
    throw new Error(
      [
        `the baseline the sandbox recorded (${args.base}) exists neither here nor on the remote — a history rewrite in the sandbox orphaned it, so the descend has nothing to merge against.`,
        `The work is not lost: it was pushed to ${args.ref} on the remote, and the sandbox workspace at ${CLOUD_WORKSPACE_PATH} still holds it.`,
        `Bring it home by hand: git fetch origin ${args.ref}, then git merge --squash FETCH_HEAD (or cherry-pick the commits) in this checkout, push the result, and descend again.`,
      ].join(' '),
    )
  }
  const tree = gitOneLine(
    await args.git({ args: ['rev-parse', '--verify', `${args.base}^{tree}`], cwd: args.cwd }),
  )
  if (tree === null) throw new Error(`the recorded baseline ${args.base} has no tree to merge against`)
  return tree
}

const conflictPathsOf = (output: string): string[] => {
  const paths = new Set<string>()
  for (const line of output.split('\n').slice(1)) {
    if (line.trim().length === 0) break
    const tab = line.lastIndexOf('\t')
    const path = tab === -1 ? line.trim() : line.slice(tab + 1)
    if (path.length > 0) paths.add(path)
  }
  return [...paths]
}

const supersededBranchOf = async (args: {
  git: GitReader
  cwd: string
  remote: string
  branch: string | null
}): Promise<SupersededBranch | undefined> => {
  if (args.branch === null) return undefined

  const fetched = await args.git({ args: ['fetch', args.remote, args.branch], cwd: args.cwd })
  if (!fetched.ok) return undefined
  const originTip = gitOneLine(await args.git({ args: ['rev-parse', '--verify', 'FETCH_HEAD'], cwd: args.cwd }))
  const localTip = gitOneLine(
    await args.git({ args: ['rev-parse', '--verify', args.branch], cwd: args.cwd }),
  )
  if (originTip === null || localTip === null || originTip === localTip) return undefined

  const contained = await args.git({
    args: ['merge-base', '--is-ancestor', localTip, originTip],
    cwd: args.cwd,
  })
  if (!contained.ok) return undefined
  return { branch: args.branch, localTip, originTip }
}

/**
 * The merge machinery refuses to run over a dirty tree, so the operator's uncommitted state is
 * committed to a dangling commit first and HEAD is put back afterwards. The merge itself is a
 * three-way content merge against the baseline's TREE — recorded at the lift and carried down
 * with the publish — never against its ancestry: the baseline is a transport commit the agent in
 * the sandbox can see and touch, so a history rewrite there must bend the merge, not break it.
 * Conflicts land as ordinary markers in the tree and are named in the result.
 */
export async function mergePublishedWorkspace(args: {
  cwd: string
  ref: string
  base: string | null
  baseTree?: string | null | undefined
  branch?: string | null | undefined
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
    const tied =
      args.base !== null &&
      (await git({ args: ['merge-base', '--is-ancestor', args.base, 'HEAD'], cwd })).ok
    if (!tied) {
      throw new Error(
        'the local checkout and the cloud workspace share no commit — the checkout has moved too far since the lift to merge them',
      )
    }
  }

  const wrappedBase = gitOneLine(await git({ args: ['rev-parse', 'FETCH_HEAD^2'], cwd }))

  const baseTree =
    wrappedBase !== null
      ? null
      : await baseTreeOf({
          git,
          cwd,
          remote,
          ref: args.ref,
          base: args.base,
          baseTree: args.baseTree ?? null,
        })

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
    const local = gitOneLine(
      await git({
        args: [
          ...ATLAS_GIT_IDENTITY,
          'commit-tree',
          tree,
          '-p',
          home,
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

    let mergeBase = wrappedBase
    if (mergeBase === null) {
      if (baseTree === null) throw new Error('the recorded baseline has no tree to merge against')
      mergeBase = gitOneLine(
        await git({
          args: [
            ...ATLAS_GIT_IDENTITY,
            'commit-tree',
            baseTree,
            '-m',
            'atlas: recorded lift baseline',
          ],
          cwd,
        }),
      )
      if (mergeBase === null) {
        throw new Error('the recorded baseline tree would not commit for the merge')
      }
    }

    const merged = await git({
      args: ['merge-tree', '--write-tree', `--merge-base=${mergeBase}`, 'HEAD', 'FETCH_HEAD'],
      cwd,
    })
    const mergedTree = merged.stdout.split('\n')[0]?.trim() ?? ''
    if (!/^[0-9a-f]{40}$/.test(mergedTree)) {
      throw new Error(`the workspace coming home would not merge: ${gitMessageOf(merged)}`)
    }

    const applied = await git({ args: ['read-tree', '-u', '-m', 'HEAD', mergedTree], cwd })
    if (!applied.ok) {
      throw new Error(`the merged tree would not land in this checkout: ${gitMessageOf(applied)}`)
    }

    result = { conflicts: merged.ok ? [] : conflictPathsOf(merged.stdout) }
  } finally {
    await putHeadBack()
  }

  await git({ args: ['push', remote, '--delete', args.ref], cwd })

  const superseded = await supersededBranchOf({
    git,
    cwd,
    remote,
    branch: args.branch ?? null,
  })
  if (superseded !== undefined) result = { ...result, superseded }

  return result
}
