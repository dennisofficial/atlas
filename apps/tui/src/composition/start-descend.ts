import { EExecutionLocation } from '@dltech/atlas-core'
import { descendFromCloud, type DescendSurface } from '@dltech/atlas-harness'

import { ENoticeTone, NOTICE_WARN_MS, notify } from '../ui/notice-store'
import { EOpenMode } from './config'
import { activateOpenedConversation } from './conversation-claim'
import { moveFailedNotice } from './container-notices'
import { messageOf } from './error-text'
import { noticePortBinding } from './notice-binding'
import { openConversation, type OpenedConversation } from './open-conversation'
import { localBindingOf } from './session-binding'
import type { useContainerMove } from './use-container-move'
import type { useConversation } from './use-conversation'
import type { WorkspaceProps } from './workspace-props'

type DescendProps = Pick<WorkspaceProps, 'localApp' | 'cloudSession' | 'cloudBridge' | 'cloudStores' | 'restoreWorkspace' | 'onLeaveCloud'>

const warn = (text: string): void =>
  notify({ key: 'container-switch', tone: ENoticeTone.Warn, ttlMs: NOTICE_WARN_MS, text })

export function startDescend(args: {
  target: EExecutionLocation
  props: DescendProps
  conversation: Pick<ReturnType<typeof useConversation>, 'threadId' | 'turnInFlight'>
  containerMove: ReturnType<typeof useContainerMove>
}): void {
  const { target, props, conversation, containerMove } = args
  const { cloudSession, cloudBridge, cloudStores, localApp } = props
  if (cloudSession === null || cloudBridge === null || cloudStores === null) return

  const surface: DescendSurface<OpenedConversation> = {
    notice: noticePortBinding(),
    prepareRuntime: ({ opened, home }) => localBindingOf({ local: localApp, workspace: home.workspace, opened }),
    onBegin: ({ waves }) =>
      containerMove.handleBegin({
        target,
        rows: waves.map((wave) => ({ id: wave.ids[0] ?? wave.label, text: wave.label, nodeIds: wave.ids })),
      }),
    onNodeStart: (nodeId) => containerMove.handleNodeStart(nodeId),
    onNodeDone: (nodeId) => containerMove.handleNodeDone(nodeId),
    onTransferProgress: containerMove.handleTransferProgress,
    openLocal: async (home, threadId) => {
      const outcome = await openConversation({
        preparing: true,
        threads: home.threads,
        remoteThreads: cloudStores.threads,
        log: home.log,
        ledger: home.ledger,
        agents: home.agents,
        shells: localApp.shells,
        services: localApp.services,
        ids: home.ids,
        workspace: home.workspace,
        open: { mode: EOpenMode.Resume, threadId },
        effects: (name) => home.tools.find(name)?.effect,
      })
      if ('cloud' in outcome || !outcome.ok) {
        throw new Error('cloud' in outcome ? 'the descend left the thread marked cloud' : outcome.reason)
      }
      const arrived = { ...outcome.conversation, executionLocation: EExecutionLocation.Host }
      return conversation.turnInFlight() ? { ...arrived, resumeOnArrival: true } : arrived
    },
  }

  void descendFromCloud({
    threadId: conversation.threadId,
    target: EExecutionLocation.Host,
    midTurn: conversation.turnInFlight(),
    bridge: cloudBridge,
    channel: cloudSession.channel,
    localApp,
    surface,
    placement: localApp.sessionOwner,
    ...(props.restoreWorkspace === undefined ? {} : { restoreWorkspace: props.restoreWorkspace }),
  })
    .then(async (opened) => {
      const warning = await activateOpenedConversation({
        threadId: conversation.threadId,
        log: localApp.log,
        ids: localApp.ids,
        shells: localApp.shells,
        services: localApp.services,
      }).catch((error: unknown) => messageOf(error))
      if (warning !== null) warn(`the session is home on the host, but reopening it here was incomplete — ${warning}`)
      if (target === EExecutionLocation.Docker) {
        const moved = await localApp.moveTools({ threadId: conversation.threadId, target, cwd: localApp.sessionOwner.require().cwd })
        if (!moved.ok) {
          warn(moveFailedNotice({ target, from: EExecutionLocation.Host, detail: `the session is home on the host — ${moved.reason}` }))
        }
      }
      containerMove.handleSettle()
      props.onLeaveCloud(opened)
    })
    .catch((error: unknown) => {
      const reason = moveFailedNotice({ target, from: EExecutionLocation.Cloud, detail: messageOf(error) })
      containerMove.handleFail(reason)
      warn(reason)
    })
}
