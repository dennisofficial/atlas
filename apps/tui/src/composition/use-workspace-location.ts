import { useCallback, useEffect, useRef } from 'react'

import { EExecutionLocation } from '@dltech/atlas-core'
import { recoverSession } from './session-recovery'

import { isShellRunning } from '../ui/shells-model'
import { ENoticeTone, NOTICE_WARN_MS, notify } from '../ui/notice-store'
import { EContainerAsk } from './commands'
import {
  bornCloudRefusalNotice,
  bornLocalRefusalNotice,
  currentLocationNotice,
  movedLocationNotice,
  moveFailedNotice,
  movingNotice,
  pendingSwitchNotice,
  resourcesConnectingNotice,
  resourcesRefusalNotice,
} from './container-notices'
import { messageOf } from './error-text'
import { useContainerGuard, type ContainerGuardControl } from './use-container-guard'
import type { useContainerMove } from './use-container-move'
import type { ContainerResourcesControl } from './use-container-resources'
import type { useConversation } from './use-conversation'
import type { useExecutionLocation } from './use-execution-location'
import type { useShells } from './use-shells'
import type { WorkspaceProps } from './workspace-props'

export type WorkspaceLocation = {
  containerGuard: ContainerGuardControl
  handleContainer: (asked: EExecutionLocation | EContainerAsk) => string | undefined
  handleContainerResources: () => string | undefined
}

type LocationProps = Pick<WorkspaceProps, 'app' | 'localApp' | 'opened' | 'createBridge' | 'onReload'>

/**
 * /container. Threads are born-placed: the command reports where this one runs, and the only
 * switch left is the tool environment of a thread born on the host (host ↔ docker — the same
 * ground `execution_location` covers). A cloud target on a local-born thread, or any target off
 * a cloud-born thread, is refused with the placement named: threads do not move anymore.
 */
export function useWorkspaceLocation(args: {
  props: LocationProps
  conversation: ReturnType<typeof useConversation>
  execution: ReturnType<typeof useExecutionLocation>
  containerMove: ReturnType<typeof useContainerMove>
  containerResources: ContainerResourcesControl
  shells: ReturnType<typeof useShells>
}): WorkspaceLocation {
  const { props, conversation, execution, containerMove, shells } = args

  const containerBlockers = useCallback(
    () =>
      props.app.shells.list({ threadId: conversation.threadId }).filter(isShellRunning),
    [conversation.threadId, props.app],
  )

  const applyToolSwitch = useCallback(
    (target: EExecutionLocation): boolean => {
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
            notify({ key: 'container-switch', tone: ENoticeTone.Warn, ttlMs: NOTICE_WARN_MS, text: reason })
            return
          }
          containerMove.handleSettle()
          void conversation.refresh().catch(() => undefined)
        })
        .catch((error: unknown) => {
          const reason = moveFailedNotice({ target, from, detail: messageOf(error) })
          containerMove.handleFail(reason)
          notify({ key: 'container-switch', tone: ENoticeTone.Warn, ttlMs: NOTICE_WARN_MS, text: reason })
        })
      return true
    },
    [containerMove, conversation.refresh, conversation.threadId, execution, props.app],
  )

  const recovering = useRef(false)

  const containerGuard = useContainerGuard({ onSwitch: applyToolSwitch })

  const handleContainer = useCallback(
    (asked: EExecutionLocation | EContainerAsk): string | undefined => {
      if (asked === EContainerAsk.Current) return currentLocationNotice(execution.location)
      // The registry routes Resources to handleContainerResources before this runs.
      if (asked === EContainerAsk.Resources) return undefined
      if (asked === execution.location) return currentLocationNotice(execution.location)

      const owner = props.localApp.sessionOwner
      const record = owner.snapshot().record
      if (record !== undefined && record.born === true) {
        return asked === EExecutionLocation.Cloud
          ? bornLocalRefusalNotice()
          : bornCloudRefusalNotice(asked)
      }

      const unfinished = record?.move
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

      if (asked === EExecutionLocation.Cloud || execution.location === EExecutionLocation.Cloud) {
        return asked === EExecutionLocation.Cloud
          ? bornLocalRefusalNotice()
          : bornCloudRefusalNotice(asked)
      }

      const blockers = containerBlockers()
      if (blockers.length > 0) {
        containerGuard.handleOpen({ target: asked })
        return pendingSwitchNotice({ target: asked, count: blockers.length })
      }

      const engaged = applyToolSwitch(asked)
      if (!engaged) return undefined
      if (!conversation.started) return movedLocationNotice(asked)
      return movingNotice(asked)
    },
    [
      applyToolSwitch,
      conversation.threadId,
      containerBlockers,
      containerGuard,
      containerMove.move,
      props.createBridge,
      props.localApp,
      props.onReload,
      props.opened,
      conversation.started,
      execution,
    ],
  )

  useEffect(() => {
    if (containerGuard.state === null) return
    if (shells.running > 0) return

    containerGuard.handleApply()
  }, [containerGuard, shells.running])

  const handleContainerResources = useCallback((): string | undefined => {
    if (execution.location !== EExecutionLocation.Cloud) {
      return resourcesRefusalNotice(execution.location)
    }
    if (!execution.bound) return resourcesConnectingNotice
    args.containerResources.handleOpen()
    return undefined
  }, [args.containerResources, execution])

  return { containerGuard, handleContainer, handleContainerResources }
}
