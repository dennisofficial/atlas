import {
  EStage,
  enteredWorktreeOf,
  exitedWorktreeOf,
  type AfterTool,
  type EventDraft,
} from '@dltech/atlas-core'
import type { RegisteredHook } from '@dltech/atlas-agent'
import type { ToolOutcome } from '@dltech/atlas-core'

const outputOf = (result: ToolOutcome): unknown => (result.ok ? result.output : undefined)

export const worktreeTrackHook: RegisteredHook<AfterTool> = {
  name: 'crew-worktree-track',
  order: { stage: EStage.Observe, nudge: 0 },
  run: async ({ result }) => {
    const output = outputOf(result)
    const entered = enteredWorktreeOf(output)
    if (entered !== undefined) {
      const draft: EventDraft = {
        type: 'worktree-entered',
        path: entered.path,
        branch: entered.branch,
        ...(entered.base === undefined ? {} : { base: entered.base }),
        ...(entered.adopted === undefined ? {} : { adopted: entered.adopted }),
      }
      return { drafts: [draft] }
    }
    const exited = exitedWorktreeOf(output)
    if (exited !== undefined) {
      const draft: EventDraft = {
        type: 'worktree-exited',
        path: exited.path,
        action: exited.action,
        ...(exited.returnTo === undefined ? {} : { returnTo: exited.returnTo }),
      }
      return { drafts: [draft] }
    }
    return {}
  },
}
