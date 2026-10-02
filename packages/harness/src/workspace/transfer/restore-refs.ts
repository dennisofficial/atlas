import { copyFile } from 'node:fs/promises'
import { join } from 'node:path'

import { listWorktrees } from '../worktrees'
import { exists } from './restore-files'
import { copyReflog, createRef, createSymref, moveRef, readRefs } from './restore-git'
import { ETreeAction, type IncomingRef, type PlannedTree, type RestoreContext } from './restore-types'

const ATTEMPTS = 50
const HEADS = 'refs/heads/'

export type RefState = {
  incoming: Map<string, IncomingRef>
  host: Map<string, string>
  occupied: Set<string>
  stageGit: string
}

export async function loadRefState({ ctx, mainId }: { ctx: RestoreContext; mainId: string }): Promise<RefState> {
  const stageGit = join(ctx.extracted, 'git')
  if (!(await exists(join(stageGit, 'HEAD')))) {
    await copyFile(join(ctx.extracted, 'trees', mainId, 'git-state', 'HEAD'), join(stageGit, 'HEAD'))
  }
  const cwd = ctx.plan.repoCwd
  const incoming = new Map((await readRefs({ cwd, gitDir: stageGit })).map((item) => [item.ref, item]))
  const host = new Map((await readRefs({ cwd })).map((item) => [item.ref, item.sha]))
  const listing = await listWorktrees({ cwd })
  const occupied = new Set(
    listing.ok ? listing.worktrees.flatMap((tree) => (tree.branch === undefined ? [] : [`${HEADS}${tree.branch}`])) : [],
  )
  return { incoming, host, occupied, stageGit }
}

function freeRef({ ref, state, make }: { ref: string; state: RefState; make: () => string }): string {
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const candidate = `${ref}-${make()}`
    if (!state.host.has(candidate) && !state.occupied.has(candidate)) return candidate
  }
  throw new Error(`could not find an unused name for ${ref}`)
}

async function create({ ctx, state, ref, from, sha }: { ctx: RestoreContext; state: RefState; ref: string; from: string; sha: string }) {
  await createRef({ cwd: ctx.plan.repoCwd, ref, sha, journal: ctx.journal })
  await copyReflog({ stageGit: state.stageGit, commonDir: ctx.commonDir, from, to: ref, journal: ctx.journal })
  state.host.set(ref, sha)
}

function settleUnborn({
  ctx,
  state,
  planned,
  ref,
  current,
}: {
  ctx: RestoreContext
  state: RefState
  planned: PlannedTree
  ref: string
  current: string | undefined
}): string {
  if (planned.action !== ETreeAction.Create) return planned.tree.branch ?? ref.slice(HEADS.length)
  if (current === undefined && !state.occupied.has(ref)) {
    state.occupied.add(ref)
    return ref.slice(HEADS.length)
  }
  const renamed = freeRef({ ref, state, make: () => planned.suffix ?? ctx.suffix() })
  state.occupied.add(renamed)
  return renamed.slice(HEADS.length)
}

export async function settleBranch({
  ctx,
  state,
  planned,
}: {
  ctx: RestoreContext
  state: RefState
  planned: PlannedTree
}): Promise<string | null> {
  const branch = planned.tree.branch
  if (branch === null) return null
  const ref = `${HEADS}${branch}`
  const sha = state.incoming.get(ref)?.sha
  if (sha === undefined && planned.tree.head !== null) throw new Error(`the archive has no ref for branch ${branch}`)
  const current = state.host.get(ref)
  if (sha === undefined) return settleUnborn({ ctx, state, planned, ref, current })
  if (planned.action === ETreeAction.InPlace) {
    if (current === undefined) await create({ ctx, state, ref, from: ref, sha })
    else if (current !== sha) {
      await moveRef({ cwd: ctx.plan.repoCwd, ref, sha, previous: current, journal: ctx.journal })
      await copyReflog({ stageGit: state.stageGit, commonDir: ctx.commonDir, from: ref, to: ref, journal: ctx.journal })
      state.host.set(ref, sha)
    }
    return branch
  }
  if (current === undefined && !state.occupied.has(ref)) {
    await create({ ctx, state, ref, from: ref, sha })
    state.occupied.add(ref)
    return branch
  }
  if (current === sha && !state.occupied.has(ref)) {
    state.occupied.add(ref)
    return branch
  }
  const renamed = freeRef({ ref, state, make: () => planned.suffix ?? ctx.suffix() })
  await create({ ctx, state, ref: renamed, from: ref, sha })
  state.occupied.add(renamed)
  return renamed.slice(HEADS.length)
}

export async function importOtherRefs({
  ctx,
  state,
  handled,
}: {
  ctx: RestoreContext
  state: RefState
  handled: ReadonlySet<string>
}): Promise<void> {
  for (const item of state.incoming.values()) {
    if (handled.has(item.ref)) continue
    const current = state.host.get(item.ref)
    if (item.symref !== '') {
      if (current === undefined) await createSymref({ cwd: ctx.plan.repoCwd, ref: item.ref, target: item.symref, journal: ctx.journal })
      continue
    }
    if (current === item.sha) continue
    const target = current === undefined ? item.ref : freeRef({ ref: item.ref, state, make: ctx.suffix })
    await create({ ctx, state, ref: target, from: item.ref, sha: item.sha })
  }
}
