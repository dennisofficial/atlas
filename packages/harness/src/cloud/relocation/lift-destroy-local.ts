import { logFieldsOf } from '../../store/logs'
import { destroyLiftedWorktree } from './lift-destroy'
import type { LiftCtx } from './lift-plan'

export const destroyLiftedLocalWorktree = async (ctx: LiftCtx): Promise<void> => {
  const archive = ctx.workspaceArchive
  if (archive === undefined || ctx.restoredWorkspace === undefined) return
  const tree = archive.manifest.trees.find((candidate) => candidate.id === archive.manifest.activeId)
  if (tree === undefined) return
  await destroyLiftedWorktree({
    cwd: ctx.args.cwd,
    expected: tree.fingerprint,
    logPort: ctx.logPort,
    threadId: ctx.args.threadId,
  }).catch((error: unknown) => {
    ctx.logPort?.warn({
      source: 'cloud.lift',
      message: 'the lifted local worktree could not be destroyed; it stays on disk',
      threadId: ctx.args.threadId,
      data: { operation: 'destroy-local-worktree' },
      ...logFieldsOf({ error }),
    })
  })
}
