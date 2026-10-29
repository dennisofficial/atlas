import { useCallback, useEffect, useRef } from 'react'

import { ERunner, type ThreadId } from '@dltech/atlas-core'
import type { CloudReload, SessionOwner, SessionRuntime } from '@dltech/atlas-harness'

import { ENoticeTone, NOTICE_WARN_MS, notify } from '../ui/notice-store'
import { bootBlocks } from './boot-block-store'
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

const moveInFlight = (move: ContainerMoveControl): boolean =>
  move.move !== null && move.move.failure === null

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
  const undelivered = useRef<{
    threadId: ThreadId
    restores: (() => void)[]
    closed: boolean
  } | null>(null)

  const restoreDraft = useCallback((threadId: ThreadId) => {
    const held = undelivered.current
    if (held === null || held.threadId !== threadId) return
    bornPlacementChip(latest.current.app).clearArrivals({ threadId })
    for (const restore of [...held.restores].reverse()) restore()
    held.restores = []
    held.closed = true
  }, [])

  const releaseAttempt = useCallback((threadId: ThreadId) => {
    const held = undelivered.current
    if (held === null || held.threadId !== threadId) return
    undelivered.current = null
    bornPlacementChip(latest.current.app).clearArrivals({ threadId })
  }, [])

  const restoreUndelivered = useCallback(
    (threadId: ThreadId) => {
      restoreDraft(threadId)
      releaseAttempt(threadId)
    },
    [restoreDraft, releaseAttempt],
  )

  const birth = useCallback(
    (born: { threadId: ThreadId; runner: ERunner }) => {
      const { threadId } = born
      const birthCloud = (next: {
        threadId: ThreadId
        runner: ERunner
        projectId: string | null
      }): void => {
        const { app, owner, createBridge } = latest.current
        birthNewborn({
          app,
          owner,
          move: bootBlocks(app).narrationFor({ threadId: next.threadId }),
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
    if (moveInFlight(containerMove) || undelivered.current !== null) return
    adopt(unstartedConversation({ ids: app.ids }))
  }, [])

  const handleUnbornSend = useCallback(
    (sent: UnbornSend): boolean => {
      const { app, attached, unplaced, threadId, containerMove } = latest.current
      if (!app.pods || attached || !unplaced) return false
      const record = app.sessionOwner.placement.snapshot(threadId)
      if (record !== undefined && record.revision > 0) return false
      const chip = bornPlacementChip(app)
      const held = undelivered.current
      if (held !== null && held.threadId === threadId && held.closed) {
        sent.onUndelivered()
        return true
      }
      if (held !== null && held.threadId === threadId) {
        held.restores.push(sent.onUndelivered)
        chip.enqueueArrival({ threadId, send: sent.send })
        return true
      }
      if (moveInFlight(containerMove)) {
        sent.onUndelivered()
        return true
      }
      const state = chip.snapshot()
      const runner =
        state?.threadId === threadId && state.runner !== undefined ? state.runner : undefined
      undelivered.current = { threadId, restores: [sent.onUndelivered], closed: false }
      chip.enqueueArrival({ threadId, send: sent.send })
      birth({ threadId, runner: runner ?? preferredRunner(app) })
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

  useEffect(
    () => bornPlacementChip(latest.current.app).bindFlip(handleFlipPlacement),
    [handleFlipPlacement],
  )

  useUnbornThread({
    app: args.app,
    threadId: args.threadId,
    unplaced: args.app.pods && args.unplaced,
    attached: args.attached,
    onArrivals: (sends) => {
      undelivered.current = null
      const [first, ...rest] = sends
      if (first === undefined) return
      latest.current.onArrival(first)
      const queue = latest.current.app.pending.forThread({ threadId: latest.current.threadId })
      for (const send of rest) {
        queue.enqueue({
          text: send.text,
          images: send.images ?? [],
          files: send.files ?? [],
          context: send.context,
        })
      }
    },
  })

  return { handleNewThread, handleFlipPlacement, handleUnbornSend }
}
