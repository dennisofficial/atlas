import { useCallback, useEffect, useRef } from 'react'

import { EExecutionLocation } from '@dltech/atlas-core'
import { descendFromCloud, EDescendStep, ELiftStep, type DescendSurface } from '@dltech/atlas-harness'

import { isShellRunning } from '../ui/shells-model'
import { ENoticeTone, NOTICE_WARN_MS, notify } from '../ui/notice-store'
import { liftRefusal } from './cloud/lift-plan'
import { EContainerAsk } from './commands'
import { descendPlanOf, ELocalMoveStep } from './container-move'
import {
  currentLocationNotice,
  movedLocationNotice,
  moveFailedNotice,
  movingNotice,
  pendingSwitchNotice,
} from './container-notices'
import { EOpenMode } from './config'
import { messageOf } from './error-text'
import { noticePortBinding } from './notice-binding'
import { openConversation, type OpenedConversation } from './open-conversation'
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
  'createBridge' | 'preflightLift' | 'captureWorkspace' | 'captureContext' | 'onLifted' | 'onDescend'
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
    whenSettled: conversation.whenSettled,
    projectDirectory: conversation.projectDirectory,
    placement: props.app.executionLocation,
    createBridge: props.createBridge,
    preflightLift: props.preflightLift,
    capture: props.captureWorkspace,
    captureContext: props.captureContext,
    move: containerMove,
    onLifted: props.onLifted,
  })

  const attachLanded = useRef(props.cloudSession !== null)
  if (props.cloudSession !== null) attachLanded.current = true

  const applyContainerSwitch = useCallback(
    (target: EExecutionLocation): boolean => {
      if (target === EExecutionLocation.Cloud) {
        cloudLift.handleLift()
        return true
      }

      if (conversation.executionLocation === EExecutionLocation.Cloud && !attachLanded.current) {
        notify({
          key: 'container-switch',
          tone: ENoticeTone.Warn,
          ttlMs: NOTICE_WARN_MS,
          text: 'the sandbox is still connecting — /container off works once the channel is open',
        })
        return false
      }

      if (
        conversation.executionLocation === EExecutionLocation.Cloud &&
        props.cloudSession !== null &&
        props.cloudBridge !== null &&
        props.cloudStores !== null
      ) {
        const { channel } = props.cloudSession
        const bridge = props.cloudBridge
        const cloudStores = props.cloudStores
        const descendSurface: DescendSurface<OpenedConversation> = {
          notice: noticePortBinding(),
          onBegin: ({ plan }) =>
            containerMove.handleBegin({ target, plan: descendPlanOf(plan) }),
          onProgress: (step) => {
            if (step === ELiftStep.Interrupting || step === EDescendStep.Transferring || step === EDescendStep.Flipping) {
              containerMove.handleAdvance(step)
              return
            }
            containerMove.handleAdvance(ELocalMoveStep.Relocating)
          },
          openLocal: (home, threadId) =>
            openConversation({
              threads: home.threads,
              remoteThreads: cloudStores.threads,
              log: home.log,
              ledger: home.ledger,
              agents: home.agents,
              shells: props.localApp.shells,
              services: props.localApp.services,
              ids: home.ids,
              workspace: home.workspace,
              open: { mode: EOpenMode.Resume, threadId },
              effects: (name) => home.tools.find(name)?.effect,
            }).then((outcome) => {
              if ('cloud' in outcome || !outcome.ok) {
                throw new Error('cloud' in outcome ? 'the descend left the thread marked cloud' : outcome.reason)
              }
              return conversation.turnInFlight()
                ? { ...outcome.conversation, resumeOnArrival: true }
                : outcome.conversation
            }),
        }
        void descendFromCloud({
          threadId: conversation.threadId,
          target,
          midTurn: conversation.turnInFlight(),
          bridge,
          channel,
          localApp: props.localApp,
          surface: descendSurface,
          placement: props.app.executionLocation,
        })
          .then((opened) => {
            containerMove.handleSettle()
            props.onDescend(opened)
          })
          .catch((error: unknown) => {
            const reason = moveFailedNotice({
              target,
              from: EExecutionLocation.Cloud,
              detail: messageOf(error),
            })
            containerMove.handleFail(reason)
            notify({
              key: 'container-switch',
              tone: ENoticeTone.Warn,
              ttlMs: NOTICE_WARN_MS,
              text: reason,
            })
          })
        return true
      }

      containerMove.handleBegin({ target })
      const threadId = conversation.threadId
      const from = execution.location

      containerMove.handleAdvance(ELocalMoveStep.Relocating)
      void props.app
        .moveTools({ threadId, target, onProgress: () => containerMove.handleAdvance(ELocalMoveStep.Flipping) })
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
          void conversation.refresh()
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
      conversation.attachPending,
      conversation.executionLocation,
      conversation.turnInFlight,
      execution,
      props.app,
      props.localApp,
      props.cloudSession,
      props.cloudBridge,
      props.cloudStores,
      props.onDescend,
    ],
  )

  const containerGuard = useContainerGuard({ onSwitch: applyContainerSwitch })

  const handleContainer = useCallback(
    (asked: EExecutionLocation | EContainerAsk): string | undefined => {
      if (asked === EContainerAsk.Current) return currentLocationNotice(execution.location)
      if (asked === execution.location) return currentLocationNotice(execution.location)
      if (containerMove.move !== null) {
        return 'a move is already underway — wait for it to settle'
      }

      if (asked === EExecutionLocation.Cloud) {
        const refusal = liftRefusal({ compacting: conversation.compacting !== null })
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
      containerBlockers,
      containerGuard,
      containerMove.move,
      conversation.compacting,
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
