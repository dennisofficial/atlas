import { copyFile, readdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { assertStillReplaceable } from './restore-destination'
import { exists, makeDirs, mergeInto, moveEntry, stashEntry } from './restore-files'
import { git, importObjects, mustGit } from './restore-git'
import { OPERATION_STATE_ROOTS } from './git-state'
import { sweepOriginals } from './restore-snapshot'
import { isPrivateRefName } from './capture-refs'
import { importOtherRefs, installMainPrivateRefs, isRelocatedMain, loadRefState, settleBranch, type RefState } from './restore-refs'
import { ETreeAction, type PlannedTree, type RestoreContext, type TreeOutcome } from './restore-types'

const HEADS = 'refs/heads/'

const treePart = ({ ctx, planned, part }: { ctx: RestoreContext; planned: PlannedTree; part: string }): string =>
  join(ctx.extracted, 'trees', planned.tree.id, part)

async function enableWorktreeConfig({ ctx }: { ctx: RestoreContext }) {
  const config = join(ctx.commonDir, 'config')
  const read = (key: string) => git({ args: ['config', '--file', config, '--get', key], cwd: ctx.plan.repoCwd })
  if ((await read('extensions.worktreeConfig')).stdout.trim() === 'true') return
  await stashEntry({ path: config, key: 'config', journal: ctx.journal })
  await copyFile(join(ctx.journal.backupRoot, 'config'), config)
  await mustGit({ args: ['config', '--file', config, 'core.repositoryformatversion', '1'], cwd: ctx.plan.repoCwd })
  await mustGit({ args: ['config', '--file', config, 'extensions.worktreeConfig', 'true'], cwd: ctx.plan.repoCwd })
}

async function installState({ ctx, planned, gitDir, skipHead }: { ctx: RestoreContext; planned: PlannedTree; gitDir: string; skipHead: boolean }) {
  const from = treePart({ ctx, planned, part: 'git-state' })
  if (!(await exists(from))) return
  const incoming = new Set(await readdir(from))
  for (const child of incoming) {
    if (skipHead && child === 'HEAD') continue
    if (child === 'config.worktree') await enableWorktreeConfig({ ctx })
    const target = join(gitDir, child)
    await stashEntry({ path: target, key: join('state', planned.tree.id, child), journal: ctx.journal })
    await moveEntry({ from: join(from, child), to: target, journal: ctx.journal })
  }
  await pruneStaleState({ ctx, planned, gitDir, incoming })
}

async function pruneStaleState({
  ctx,
  planned,
  gitDir,
  incoming,
}: {
  ctx: RestoreContext
  planned: PlannedTree
  gitDir: string
  incoming: ReadonlySet<string>
}) {
  for (const root of OPERATION_STATE_ROOTS) {
    if (incoming.has(root)) continue
    await stashEntry({ path: join(gitDir, root), key: join('stale', planned.tree.id, root), journal: ctx.journal })
  }
}

async function placeIndex({ ctx, planned, gitDir }: { ctx: RestoreContext; planned: PlannedTree; gitDir: string }) {
  const incoming = treePart({ ctx, planned, part: 'index' })
  await stashEntry({ path: join(gitDir, 'index'), key: join('index', planned.tree.id), journal: ctx.journal })
  if (!(await exists(incoming))) return
  await moveEntry({ from: incoming, to: join(gitDir, 'index'), journal: ctx.journal })
  await git({ args: ['update-index', '-q', '--refresh'], cwd: planned.path })
}

async function copySharedIndexes({ ctx, gitDir }: { ctx: RestoreContext; gitDir: string }) {
  const source = join(ctx.extracted, 'git')
  for (const name of (await readdir(source).catch(() => [])).filter((item) => item.startsWith('sharedindex.'))) {
    const target = join(gitDir, name)
    if (await exists(target)) continue
    await copyFile(join(source, name), target)
    ctx.journal.undo.push(() => rm(target, { force: true }))
  }
}

async function placeFiles({ ctx, planned }: { ctx: RestoreContext; planned: PlannedTree }) {
  if (planned.action === ETreeAction.InPlace) {
    const others = [...ctx.plan.registered, ...ctx.plan.trees.map((item) => item.path)].filter((path) => path !== planned.path)
    await sweepOriginals({ root: planned.path, excluded: others, key: join('files', planned.tree.id), journal: ctx.journal, beforeSweep: ctx.beforeSweep })
  }
  await mergeInto({ from: treePart({ ctx, planned, part: 'files' }), to: planned.path, journal: ctx.journal })
}

async function gitDirOf(path: string): Promise<string> {
  return (await mustGit({ args: ['rev-parse', '--path-format=absolute', '--absolute-git-dir'], cwd: path })).trim()
}

async function addWorktree({ ctx, planned, branch }: { ctx: RestoreContext; planned: PlannedTree; branch: string | null }) {
  const head = planned.tree.head
  if (branch === null && head === null) throw new Error(`worktree ${planned.tree.name} has neither a branch nor a commit to restore`)
  const unborn = branch !== null && head === null
  const target = branch === null ? ['--detach', planned.path, head ?? ''] : unborn ? ['--orphan', '-b', branch, planned.path] : [planned.path, branch]
  await makeDirs({ path: dirname(planned.path), journal: ctx.journal })
  const deferCheckout = unborn ? [] : ['--no-checkout']
  await mustGit({ args: ['worktree', 'add', ...deferCheckout, ...target], cwd: ctx.plan.repoCwd })
  ctx.journal.undo.push(async () => {
    const remaining = (await readdir(planned.path).catch(() => ['.git'])).filter((name) => name !== '.git')
    if (remaining.length > 0) throw new Error(`${planned.path} gained ${remaining.join(', ')} after the restore; it was left in place`)
    await mustGit({ args: ['worktree', 'remove', '--force', planned.path], cwd: ctx.plan.repoCwd })
    await mustGit({ args: ['worktree', 'prune'], cwd: ctx.plan.repoCwd })
  })
}

async function alignHead({ ctx, planned, target }: { ctx: RestoreContext; planned: PlannedTree; target: string | null }) {
  const current = (await git({ args: ['symbolic-ref', '-q', 'HEAD'], cwd: planned.path })).stdout.trim()
  const branch = target
  const wanted = branch === null ? '' : `${HEADS}${branch}`
  if (current === wanted || (branch === null && current === '')) return
  if (branch === null) await mustGit({ args: ['update-ref', '--no-deref', 'HEAD', planned.tree.head ?? ''], cwd: planned.path })
  else await mustGit({ args: ['symbolic-ref', 'HEAD', wanted], cwd: planned.path })
  ctx.journal.undo.push(async () => {
    if (current !== '') await mustGit({ args: ['symbolic-ref', 'HEAD', current], cwd: planned.path })
  })
}

const outcomeOf = ({ planned, branch }: { planned: PlannedTree; branch: string | null }): TreeOutcome => {
  const original = planned.tree.branch
  const renamedBranch = branch !== original ? original : null
  const aside = planned.suffix !== null || planned.action === ETreeAction.Reuse
  return { planned, branch, renamedFrom: aside ? planned.tree.name : renamedBranch }
}

async function linkedTree({ ctx, planned, branch }: { ctx: RestoreContext; planned: PlannedTree; branch: string | null }) {
  if (planned.action === ETreeAction.Create) await addWorktree({ ctx, planned, branch })
  await placeFiles({ ctx, planned })
  const gitDir = await gitDirOf(planned.path)
  await installState({ ctx, planned, gitDir, skipHead: true })
  await copySharedIndexes({ ctx, gitDir })
  await placeIndex({ ctx, planned, gitDir })
  if (planned.action === ETreeAction.InPlace) await alignHead({ ctx, planned, target: branch })
}

export async function applyPlain({ ctx }: { ctx: RestoreContext }): Promise<TreeOutcome[]> {
  const planned = ctx.plan.trees[0]
  if (planned === undefined) throw new Error('nothing to restore')
  if (planned.action === ETreeAction.InPlace) await assertStillReplaceable({ path: planned.path, tree: planned.tree, repoCwd: ctx.plan.repoCwd })
  await placeFiles({ ctx, planned })
  return [outcomeOf({ planned, branch: null })]
}

export async function applyFresh({ ctx }: { ctx: RestoreContext }): Promise<TreeOutcome[]> {
  const main = ctx.plan.trees.find((item) => item.tree.isMain)
  if (main === undefined) throw new Error('archive has no main tree')
  const gitDir = join(ctx.plan.anchor, '.git')
  await moveEntry({ from: join(ctx.extracted, 'git'), to: gitDir, journal: ctx.journal })
  await installState({ ctx, planned: main, gitDir, skipHead: false })
  await placeFiles({ ctx, planned: main })
  await placeIndex({ ctx, planned: main, gitDir })
  const outcomes = [outcomeOf({ planned: main, branch: main.tree.branch })]
  for (const planned of ctx.plan.trees.filter((item) => item !== main)) {
    await linkedTree({ ctx, planned, branch: planned.tree.branch })
    outcomes.push(outcomeOf({ planned, branch: planned.tree.branch }))
  }
  return outcomes
}

export async function applyExisting({ ctx }: { ctx: RestoreContext }): Promise<TreeOutcome[]> {
  const main = ctx.plan.trees.find((item) => item.tree.isMain)
  if (main === undefined) throw new Error('archive has no main tree')
  const state: RefState = await loadRefState({ ctx, mainId: main.tree.id })
  await importObjects({ stageGit: state.stageGit, commonDir: ctx.commonDir, journal: ctx.journal })
  const outcomes: TreeOutcome[] = []
  let relocatedMain = false
  for (const planned of ctx.plan.trees) {
    if (planned.action === ETreeAction.Reuse) {
      const head = (await git({ args: ['symbolic-ref', '-q', '--short', 'HEAD'], cwd: planned.path })).stdout.trim()
      outcomes.push(outcomeOf({ planned, branch: head === '' ? null : head }))
      continue
    }
    if (planned.action === ETreeAction.InPlace) await assertStillReplaceable({ path: planned.path, tree: planned.tree, repoCwd: ctx.plan.repoCwd })
    const branch = await settleBranch({ ctx, state, planned })
    await linkedTree({ ctx, planned, branch })
    if (isRelocatedMain({ ctx, planned })) {
      await installMainPrivateRefs({ ctx, state, planned, gitDir: await gitDirOf(planned.path) })
      relocatedMain = true
    }
    outcomes.push(outcomeOf({ planned, branch }))
  }
  const handled = new Set([
    ...ctx.manifest.trees.flatMap((tree) => (tree.branch === null ? [] : [`${HEADS}${tree.branch}`])),
    ...(relocatedMain ? [...state.incoming.keys()].filter(isPrivateRefName) : []),
  ])
  await importOtherRefs({ ctx, state, handled })
  return outcomes
}
