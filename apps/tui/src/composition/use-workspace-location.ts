import { useCallback, useEffect, useRef } from 'react'

import { EExecutionLocation } from '@dltech/atlas-core'
import { recoverSession } from './session-recovery'
import { startDescend } from './start-descend'

import { isShellRunning } from '../ui/shells-model'
import { ENoticeTone, NOTICE_WARN_MS, notify } from '../ui/notice-store'
import { liftRefusal } from './cloud/lift-plan'
import { EContainerAsk } from './commands'
import {
  currentLocationNotice,
  movedLocationNotice,
  moveFailedNotice,
  movingNotice,
  pendingSwitchNotice,
} from './container-notices'
import { messageOf } from './error-text'
import { useCloudLift } from './use-cloud-lift'
import { useContainerGuard, type ContainerGuardControl } from './use-container-guard'
import type { useContainerMove } from './use-container-move'
import type { useConversation } from './use-conversation'
import type { useExecutionLocation } from './use-execution-location'
import type { useShells } from './use-shells'
import type { WorkspaceProps } from './workspace-props'

export type WorkspaceLocation = {
  containerGuard: ContainerGuardControl
  handleContainer: (asked: EExecutionLocation | EContainerAsk) => string | undefined
}

type LocationProps = Pick<WorkspaceProps,
  'app' | 'localApp' | 'cloudSession' | 'cloudBridge' | 'cloudStores' |
  'opened' | 'createBridge' | 'preflightLift' | 'captureWorkspace' | 'captureArchive' | 'restoreWorkspace' |
  'captureContext' | 'onReload' | 'onLeaveCloud'
>

export function useWorkspaceLocation(args: {
  props: LocationProps
  conversation: ReturnType<typeof useConversation>
  execution: ReturnType<typeof useExecutionLocation>
  containerMove: ReturnType<typeof useContainerMove>
  shells: ReturnType<typeof useShells>
}): WorkspaceLocation {
  const { props, conversation, execution, containerMove, shells } = args

  const containerBlockers = useCallback(
    () =>
      props.app.shells.list({ threadId: conversation.threadId }).filter(isShellRunning),
    [conversation.threadId, props.app],
  )

  const cloudLift = useCloudLift({
    app: props.app,
    threadId: conversation.threadId,
    started: conversation.started,
    midTurn: conversation.turnInFlight,
    handleInterrupt: conversation.handleInterruptForMove,
    handlePause: conversation.handlePauseForMove,
    handleResumeSource: conversation.handleResumeSource,
    whenSettled: conversation.whenSettled,
    projectDirectory: conversation.projectDirectory,
    owner: props.localApp.sessionOwner,
    createBridge: props.createBridge,
    preflightLift: props.preflightLift,
    capture: props.captureWorkspace,
    captureArchive: props.captureArchive,
    captureContext: props.captureContext,
    move: containerMove,
    onReload: props.onReload,
  })

  const applyContainerSwitch = useCallback(
    (target: EExecutionLocation): boolean => {
      if (target === EExecutionLocation.Cloud) {
        cloudLift.handleLift()
        return true
      }

      if (execution.location === EExecutionLocation.Cloud && !execution.bound) {
        notify({
          key: 'container-switch',
          tone: ENoticeTone.Warn,
          ttlMs: NOTICE_WARN_MS,
          text: 'the sandbox is still connecting — /container off works once the channel is open',
        })
        return false
      }

      if (
        execution.location === EExecutionLocation.Cloud &&
        props.cloudSession !== null &&
        props.cloudBridge !== null &&
        props.cloudStores !== null
      ) {
        startDescend({
          target,
          props: {
            localApp: props.localApp,
            cloudSession: props.cloudSession,
            cloudBridge: props.cloudBridge,
            cloudStores: props.cloudStores,
            restoreWorkspace: props.restoreWorkspace,
            onLeaveCloud: props.onLeaveCloud,
          },
          conversation,
          containerMove,
        })
        return true
      }

      containerMove.handleBegin({
        target,
        rows: [
          { id: 'stopping', text: 'stopping services, moving sub-agents', nodeIds: ['stopping'] },
          { id: 'flipping', text: 'handing the conversation over', nodeIds: ['flipping'] },
        ],
      })
      containerMove.handleRowActive('stopping')
      const threadId = conversation.threadId
      const from = execution.location

      void props.app
        .moveTools({ threadId, target, onProgress: () => containerMove.handleRowActive('flipping') })
        .then((moved) => {
          if (!moved.ok) {
            const reason = moveFailedNotice({ target, from, detail: moved.reason })
            containerMove.handleFail(reason)
            notify({
              key: 'container-switch',
              tone: ENoticeTone.Warn,
              ttlMs: NOTICE_WARN_MS,
              text: reason,
            })
            return
          }
          containerMove.handleSettle()
          void conversation.refresh().catch(() => undefined)
        })
        .catch((error: unknown) => {
          const reason = moveFailedNotice({ target, from, detail: messageOf(error) })
          containerMove.handleFail(reason)
          notify({
            key: 'container-switch',
            tone: ENoticeTone.Warn,
            ttlMs: NOTICE_WARN_MS,
            text: reason,
          })
        })
      return true
    },
    [
      cloudLift,
      containerBlockers,
      containerMove,
      conversation.refresh,
      conversation.threadId,
      conversation.started,
      conversation.turnInFlight,
      execution,
      props.app,
      props.localApp,
      props.cloudSession,
      props.cloudBridge,
      props.cloudStores,
      props.onLeaveCloud,
      props.restoreWorkspace,
    ],
  )

  const recovering = useRef(false)

  const containerGuard = useContainerGuard({ onSwitch: applyContainerSwitch })

  const handleContainer = useCallback(
    (asked: EExecutionLocation | EContainerAsk): string | undefined => {
      if (asked === EContainerAsk.Current) return currentLocationNotice(execution.location)
      if (asked === execution.location) return currentLocationNotice(execution.location)
      const owner = props.localApp.sessionOwner
      const unfinished = owner.snapshot().record?.move
      if (unfinished != null && owner.placement.startedHere(unfinished.id)) {
        return 'a move is already underway — wait for it to settle'
      }
      if (unfinished != null) {
        if (recovering.current) return 'a recovery is already underway — wait for it to settle'
        recovering.current = true
        void recoverSession({
          owner,
          app: props.localApp,
          threadId: conversation.threadId,
          bridge: props.createBridge,
          opened: props.opened,
          onReload: props.onReload,
        }).then((outcome) => {
          recovering.current = false
          if (outcome.recovered) return
          notify({
            key: 'container-switch',
            tone: ENoticeTone.Warn,
            ttlMs: NOTICE_WARN_MS,
            text: `this session has an unfinished move that could not be recovered yet — ${outcome.reason}`,
          })
        })
        return 'this session has an unfinished move — recovering it first; ask again once it settles'
      }
      if (containerMove.move !== null) {
        return 'a move is already underway — wait for it to settle'
      }

      if (asked === EExecutionLocation.Cloud) {
        const refusal = liftRefusal({
          compacting: conversation.compacting !== null,
          rotating: conversation.rotating !== null,
        })
        if (refusal !== null) return refusal
      }

      const blockers = containerBlockers()
      if (blockers.length > 0) {
        containerGuard.handleOpen({ target: asked })
        return pendingSwitchNotice({ target: asked, count: blockers.length })
      }

      const engaged = applyContainerSwitch(asked)
      if (!engaged) return undefined
      if (!conversation.started && asked !== EExecutionLocation.Cloud) {
        return movedLocationNotice(asked)
      }

      if (asked === EExecutionLocation.Cloud) return undefined
      return movingNotice(asked)
    },
    [
      applyContainerSwitch,
      conversation.threadId,
      containerBlockers,
      containerGuard,
      containerMove.move,
      props.createBridge,
      props.localApp,
      props.onReload,
      props.opened,
      conversation.compacting,
      conversation.rotating,
      conversation.started,
      execution,
    ],
  )

  useEffect(() => {
    if (containerGuard.state === null) return
    if (shells.running > 0) return

    containerGuard.handleApply()
  }, [containerGuard, shells.running])

  return { containerGuard, handleContainer }
}
