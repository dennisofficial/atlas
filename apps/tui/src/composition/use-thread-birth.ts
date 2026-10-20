import { useCallback, useEffect, useRef } from 'react'

import { ERunner, type ThreadId } from '@dltech/atlas-core'
import type { CloudReload, SessionOwner, SessionRuntime } from '@dltech/atlas-harness'

import { ENoticeTone, NOTICE_WARN_MS, notify } from '../ui/notice-store'
import { birthNewborn } from './cloud/birth-newborn'
import { bornWith, preferredRunner, rememberPlacement } from './cloud/born-cloud'
import { bornPlacementChip } from './cloud/born-placement-chip'
import type { CloudBridgeFactory, BirthPreflight } from './cloud/bridge-factory'
import { useProjectResolution } from './cloud/use-project-resolution'
import { preferenceChipFor, useUnbornThread } from './cloud/use-unborn-thread'
import type { AtlasApp } from './compose'
import type { SendArgs } from './conversation-types'
import { messageOf } from './error-text'
import { unstartedConversation, type OpenedConversation } from './open-conversation'
import type { ContainerMoveControl } from './use-container-move'
import type { ProjectPromptControl } from './use-project-prompt'

export type UnbornSend = { send: SendArgs; onUndelivered: () => void }

export type ThreadBirth = {
  handleNewThread: () => void
  handleFlipPlacement: () => void
  handleUnbornSend: (sent: UnbornSend) => boolean
}

const birthInFlight = (move: ContainerMoveControl): boolean => move.move !== null && move.move.failure === null

export function useThreadBirth(args: {
  app: AtlasApp
  owner: SessionOwner<SessionRuntime>
  containerMove: ContainerMoveControl
  projectPrompt: Pick<ProjectPromptControl, 'ask' | 'isMounted'>
  createBridge: CloudBridgeFactory
  preflightBirth?: BirthPreflight | undefined
  onSignInRequired: () => void
  adopt: (opened: OpenedConversation) => void
  onReload: (reload: CloudReload) => Promise<void>
  threadId: ThreadId
  unplaced: boolean
  attached: boolean
  onArrival: (send: SendArgs) => void
}): ThreadBirth {
  const latest = useRef(args)
  latest.current = args
  const resolveProject = useProjectResolution({ app: args.app, prompt: args.projectPrompt })
  const undelivered = useRef<{ threadId: ThreadId; restore: () => void } | null>(null)

  const restoreDraft = useCallback((threadId: ThreadId) => {
    const held = undelivered.current
    if (held === null || held.threadId !== threadId) return
    held.restore()
  }, [])

  const releaseAttempt = useCallback((threadId: ThreadId) => {
    const held = undelivered.current
    if (held === null || held.threadId !== threadId) return
    undelivered.current = null
  }, [])

  const restoreUndelivered = useCallback(
    (threadId: ThreadId) => {
      restoreDraft(threadId)
      releaseAttempt(threadId)
    },
    [restoreDraft, releaseAttempt],
  )

  const birth = useCallback(
    (born: { threadId: ThreadId; runner: ERunner; arrival: SendArgs }) => {
      const { threadId } = born
      const birthCloud = (next: { threadId: ThreadId; runner: ERunner; projectId: string | null }): void => {
        const { app, owner, containerMove, createBridge } = latest.current
        birthNewborn({
          app,
          owner,
          move: containerMove,
          createBridge,
          threadId: next.threadId,
          runner: next.runner,
          projectId: next.projectId,
          onReload: (reload) => latest.current.onReload(reload),
          onRestoreDraft: () => restoreDraft(next.threadId),
          onRelease: () => {
            preferenceChipFor({ app, threadId: next.threadId })
            releaseAttempt(next.threadId)
          },
        })
      }
      void bornWith({
        app: latest.current.app,
        threadId,
        choice: born.runner,
        arrival: born.arrival,
        preflightBirth: latest.current.preflightBirth,
        requireSignIn: () => latest.current.onSignInRequired(),
        resolveProject,
        birthCloud,
      })
        .then((placed) => {
          if (!placed) restoreUndelivered(threadId)
        })
        .catch((error: unknown) => {
          notify({
            key: 'born-cloud-failed',
            text: `a new thread could not be placed — ${messageOf(error)}`,
            tone: ENoticeTone.Warn,
            ttlMs: NOTICE_WARN_MS,
          })
          restoreUndelivered(threadId)
        })
    },
    [restoreUndelivered, restoreDraft, releaseAttempt, resolveProject],
  )

  const handleNewThread = useCallback(() => {
    const { app, adopt, containerMove } = latest.current
    if (birthInFlight(containerMove) || undelivered.current !== null) return
    adopt(unstartedConversation({ ids: app.ids }))
  }, [])

  const handleUnbornSend = useCallback(
    (sent: UnbornSend): boolean => {
      const { app, attached, unplaced, threadId, containerMove } = latest.current
      if (!app.pods || attached || !unplaced) return false
      const record = app.sessionOwner.placement.snapshot(threadId)
      if (record !== undefined && record.revision > 0) return false
      if (birthInFlight(containerMove) || undelivered.current !== null) {
        sent.onUndelivered()
        return true
      }
      const chip = bornPlacementChip(app).snapshot()
      const runner = chip?.threadId === threadId && chip.runner !== undefined ? chip.runner : undefined
      undelivered.current = { threadId, restore: sent.onUndelivered }
      birth({ threadId, runner: runner ?? preferredRunner(app), arrival: sent.send })
      return true
    },
    [birth],
  )

  const handleFlipPlacement = useCallback(() => {
    const { app } = latest.current
    const chip = bornPlacementChip(app)
    const state = chip.snapshot()
    if (state === null || state.preference !== true || state.provisioning) return
    const next = state.runner === ERunner.Vercel ? ERunner.Local : ERunner.Vercel
    rememberPlacement({ app, runner: next })
    chip.set({ ...state, runner: next })
  }, [])

  useEffect(() => bornPlacementChip(latest.current.app).bindFlip(handleFlipPlacement), [handleFlipPlacement])

  useUnbornThread({
    app: args.app,
    threadId: args.threadId,
    unplaced: args.app.pods && args.unplaced,
    attached: args.attached,
    onArrival: (send) => {
      undelivered.current = null
      latest.current.onArrival(send)
    },
  })

  return { handleNewThread, handleFlipPlacement, handleUnbornSend }
}
