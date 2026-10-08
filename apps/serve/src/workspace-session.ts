import type { ThreadId } from '@dltech/atlas-core'
import type { ConfirmWorkspaceCleanupReply, PrepareWorkspaceArchiveReply } from '@dltech/atlas-wire'
import { verifySourceCleanupProof, type SourceCleanupProof } from '@dltech/atlas-harness'

import type { ArchiveBuildOptions } from './archive-progress'
import { prepareWorkspaceExport, type WorkspaceCapturer } from './prepare-workspace'
import type { DirectWorkspace } from './direct-workspace'
import type { ServeApp } from './serve-app'

export type WorkspaceSession = ReturnType<typeof createWorkspaceSession>

export function createWorkspaceSession(args: {
  direct: DirectWorkspace
  driveHome: string
  threadId: ThreadId
  launchDirectory: () => string
  app: Pick<ServeApp, 'log' | 'stopWorkspaceProcesses' | 'family'> & Partial<Pick<ServeApp, 'threads'>>
  sourceSessionId?: string | undefined
  capture?: WorkspaceCapturer | undefined
  dormant: boolean
  startChildren: () => Promise<void>
}) {
  let dormant = args.dormant
  let activating: Promise<{ activated: boolean }> | undefined
  let preparing: Promise<PrepareWorkspaceArchiveReply> | undefined
  let cleanupProof: SourceCleanupProof | undefined

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

    prepare: (options?: ArchiveBuildOptions) => {
      preparing ??= (async () => {
        await args.app.family?.freeze?.({ threadId: args.threadId })
        const receipt = await args.direct.receipt()
        return prepareWorkspaceExport({
          driveHome: args.driveHome,
          threadId: args.threadId,
          launchDirectory: args.launchDirectory(),
          primaryWorkspace: receipt?.restored,
          log: args.app.log,
          threads: args.app.threads,
          sourceSessionId: args.sourceSessionId,
          onCleanupProof: (proof) => { cleanupProof = proof },
          capture: args.capture,
          stopProcesses: args.app.stopWorkspaceProcesses,
          onBuildProgress: options?.onBuildProgress,
        })
      })().finally(() => { preparing = undefined })
      return preparing
    },

    confirmCleanup: async ({ generation }: { generation: string }): Promise<ConfirmWorkspaceCleanupReply> => {
      const sourceSessionId = args.sourceSessionId ?? ''
      if (cleanupProof === undefined || cleanupProof.generation !== generation) return { safe: false, reasons: ['the source has no matching prepared cleanup generation'], sourceSessionId }
      const verdict = await verifySourceCleanupProof({ proof: cleanupProof, sourceSessionId })
      return { ...verdict, sourceSessionId }
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
