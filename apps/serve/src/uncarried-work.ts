import type { GitRunner } from './materialize-workspace'

const isAncestorOfHead = async (args: {
  git: GitRunner
  cwd: string
  tip: string
}): Promise<boolean> => {
  const run = await args.git({
    args: ['merge-base', '--is-ancestor', args.tip, 'HEAD'],
    cwd: args.cwd,
  })
  return run.ok
}

const heldByRemote = async (args: {
  git: GitRunner
  cwd: string
  tip: string
}): Promise<boolean> => {
  const run = await args.git({ args: ['branch', '-r', '--contains', args.tip], cwd: args.cwd })
  return run.ok && run.stdout.trim().length > 0
}

const uncarriedBranches = async (args: {
  git: GitRunner
  cwd: string
}): Promise<string[]> => {
  const refs = await args.git({
    args: ['for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/heads/'],
    cwd: args.cwd,
  })
  if (!refs.ok) return []

  const uncarried: string[] = []
  for (const line of refs.stdout.split('\n')) {
    const [name, tip] = line.trim().split(' ')
    if (name === undefined || tip === undefined || name.length === 0) continue
    if (await isAncestorOfHead({ git: args.git, cwd: args.cwd, tip })) continue
    if (await heldByRemote({ git: args.git, cwd: args.cwd, tip })) continue

    const count = await args.git({ args: ['rev-list', '--count', `HEAD..${tip}`], cwd: args.cwd })
    const commits = count.ok ? count.stdout.trim() : 'some'
    uncarried.push(`branch "${name}" holds ${commits} commit(s) the descend cannot carry`)
  }
  return uncarried
}

const uncarriedWorktrees = async (args: {
  git: GitRunner
  cwd: string
}): Promise<string[]> => {
  const list = await args.git({ args: ['worktree', 'list', '--porcelain'], cwd: args.cwd })
  if (!list.ok) return []

  const uncarried: string[] = []
  const blocks = list.stdout.split(/\n\n+/).filter((block) => block.trim().length > 0)
  for (const block of blocks.slice(1)) {
    const lines = block.split('\n')
    const pathLine = lines[0]
    if (pathLine === undefined || !pathLine.startsWith('worktree ')) continue
    const path = pathLine.slice('worktree '.length)

    const status = await args.git({ args: ['status', '--porcelain'], cwd: path })
    if (status.ok && status.stdout.trim().length > 0) {
      uncarried.push(`worktree ${path} holds uncommitted changes`)
      continue
    }
    if (!lines.includes('detached')) continue

    const headLine = lines.find((line) => line.startsWith('HEAD '))
    const tip = headLine?.slice('HEAD '.length).trim()
    if (tip === undefined || tip.length === 0) continue
    if (await isAncestorOfHead({ git: args.git, cwd: args.cwd, tip })) continue
    if (await heldByRemote({ git: args.git, cwd: args.cwd, tip })) continue
    uncarried.push(`worktree ${path} sits on a detached commit no branch holds`)
  }
  return uncarried
}

/**
 * Only HEAD rides home. A side branch or nested worktree reads as an untouched checkout from the
 * publisher, so each one that holds work names itself here — the alternative is the descend
 * reporting success while that work dies with the sandbox.
 */
export const uncarriedWork = async (args: {
  git: GitRunner
  cwd: string
}): Promise<string[]> => [
  ...(await uncarriedBranches(args)),
  ...(await uncarriedWorktrees(args)),
]
