import { realpath } from 'node:fs/promises'
import { sep } from 'node:path'

import type { LogPort, ThreadId } from '@dltech/atlas-core'

import { logFieldsOf } from '../../store/logs'
import { fingerprintWorkspaceTree } from '../../workspace/transfer/capture-fingerprint'
import { listWorktrees, removeWorktree, type Worktree } from '../../workspace/worktrees'

export enum EDestroySkip {
  MainCheckout = 'main-checkout',
  OutsideWorktrees = 'outside-worktrees',
}

export type DestroyPlan =
  | { kind: 'remove'; path: string }
  | { kind: 'skip'; reason: EDestroySkip }

const isInside = ({ parent, child }: { parent: string; child: string }): boolean =>
  child === parent || child.startsWith(`${parent}${sep}`)

export const destroyPlanOf = ({
  worktrees,
  cwd,
}: {
  worktrees: readonly Worktree[]
  cwd: string
}): DestroyPlan => {
  const containing = worktrees
    .filter((worktree) => isInside({ parent: worktree.path, child: cwd }))
    .sort((left, right) => right.path.length - left.path.length)[0]
  if (containing === undefined) return { kind: 'skip', reason: EDestroySkip.OutsideWorktrees }
  if (containing.isMain) return { kind: 'skip', reason: EDestroySkip.MainCheckout }
  return { kind: 'remove', path: containing.path }
}

export async function destroyLiftedWorktree({
  cwd,
  expected,
  logPort,
  threadId,
}: {
  cwd: string
  expected: string
  logPort?: LogPort | undefined
  threadId: ThreadId
}): Promise<void> {
  const listing = await listWorktrees({ cwd })
  if (!listing.ok) {
    logPort?.warn({
      source: 'cloud.lift',
      message: 'the lifted local worktree could not be inspected; it stays on disk',
      threadId,
      data: { operation: 'destroy-local-worktree', reason: listing.message },
    })
    return
  }
  const plan = destroyPlanOf({ worktrees: listing.worktrees, cwd: await realpath(cwd).catch(() => cwd) })
  if (plan.kind === 'skip') {
    if (plan.reason === EDestroySkip.MainCheckout) {
      logPort?.info({
        source: 'cloud.lift',
        message: 'the lifted session lived in the main checkout — nothing is destroyed',
        threadId,
        data: { operation: 'destroy-local-worktree' },
      })
    }
    return
  }
  const current = await fingerprintWorkspaceTree({ cwd: plan.path }).catch(() => null)
  if (current !== expected) {
    logPort?.warn({
      source: 'cloud.lift',
      message: `the lifted local worktree ${plan.path} changed after it was captured; it stays on disk`,
      threadId,
      data: { operation: 'destroy-local-worktree', path: plan.path, matches: current === expected },
    })
    return
  }
  const mainCwd = listing.worktrees.find((worktree) => worktree.isMain)?.path ?? cwd
  const removal = await removeWorktree({ cwd: mainCwd, path: plan.path, force: true })
  if (!removal.worktreeRemoved.ok) {
    logPort?.warn({
      source: 'cloud.lift',
      message: `the lifted local worktree ${plan.path} refused removal and stays on disk`,
      threadId,
      data: { operation: 'destroy-local-worktree', path: plan.path, reason: removal.worktreeRemoved.message },
    })
    return
  }
  logPort?.info({
    source: 'cloud.lift',
    message: `the lifted local worktree ${plan.path} was destroyed after the swap was verified`,
    threadId,
    data: { operation: 'destroy-local-worktree', path: plan.path },
  })
}
