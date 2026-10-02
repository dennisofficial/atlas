import type { ThreadId } from '@dltech/atlas-core'
import type { PrepareWorkspaceArchiveReply } from '@dltech/atlas-wire'

import { prepareWorkspaceExport, type WorkspaceCapturer } from './prepare-workspace'
import type { DirectWorkspace } from './direct-workspace'
import type { ServeApp } from './serve-app'

export type WorkspaceSession = ReturnType<typeof createWorkspaceSession>

export function createWorkspaceSession(args: {
  direct: DirectWorkspace
  driveHome: string
  threadId: ThreadId
  launchDirectory: () => string
  app: Pick<ServeApp, 'log' | 'stopWorkspaceProcesses' | 'family'>
  capture?: WorkspaceCapturer | undefined
  dormant: boolean
  startChildren: () => Promise<void>
}) {
  let dormant = args.dormant
  let activating: Promise<{ activated: boolean }> | undefined
  let preparing: Promise<PrepareWorkspaceArchiveReply> | undefined

  const activate = (): Promise<{ activated: boolean }> => {
    if (!dormant) return Promise.resolve({ activated: true })
    activating ??= (async () => {
      await args.startChildren()
      await args.direct.markActivated()
      dormant = false
      return { activated: true }
    })().finally(() => { activating = undefined })
    return activating
  }

  return {
    dormant: (): boolean => dormant,

    prepare: () => {
      preparing ??= (async () => {
        await args.app.family?.freeze?.({ threadId: args.threadId })
        return prepareWorkspaceExport({
          driveHome: args.driveHome,
          threadId: args.threadId,
          launchDirectory: args.launchDirectory(),
          log: args.app.log,
          capture: args.capture,
          stopProcesses: args.app.stopWorkspaceProcesses,
        })
      })().finally(() => { preparing = undefined })
      return preparing
    },

    apply: async () => {
      const result = await args.direct.apply()
      if (result === null) return null
      if (result.applied) dormant = true
      return {
        applied: result.applied,
        restored: { ...result.restored, trees: [...result.restored.trees] },
      }
    },

    activate,
  }
}
