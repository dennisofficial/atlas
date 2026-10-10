import { useCallback, useRef } from 'react'

import { EExecutionLocation } from '@dltech/atlas-core'
import {
  liftToCloud,
  stopLocalWork,
  storedModel,
  type CloudReload,
  type SessionOwner,
  type SessionRuntime,
} from '@dltech/atlas-harness'

import { ENoticeTone, NOTICE_WARN_MS, notify } from '../ui/notice-store'
import { bornWith } from './cloud/born-cloud'
import { cloudRuntimeParts, openCloudConversation } from './cloud/cloud-app'
import { cloudReadinessOf } from './cloud/cloud-readiness'
import { CLOUD_LIFT_NOTICE_KEY, liftFailedNotice } from './cloud/lift-notices'
import { createCloudRunner } from './cloud/cloud-runner'
import { createCloudSession } from './cloud/cloud-session'
import { parkHookFor } from './cloud/park-hook'
import { mirrorCloudRenames } from './cloud/rename-mirror'
import type { AtlasApp } from './compose'
import { durableOpLog } from './durable-op-log'
import { messageOf } from './error-text'
import type { OpenedConversation } from './open-conversation'
import { cloudAnchorOf, cloudBindingOf, prepareOn } from './session-binding'
import type { CloudBridgeFactory, LiftPreflight } from './use-cloud-lift'
import type { useContainerMove } from './use-container-move'

export type ThreadBirth = {
  handleNewThread: () => void
}

/**
 * /new. A thread is born-placed: the cloud when this machine can provision a sandbox, the host
 * otherwise — and it never moves afterwards. The cloud birth is the same provisioning a bare
 * `/container cloud` ran, minus everything a history would transfer: there is nothing to pause,
 * capture, or verify, because the thread has no events yet.
 */
export function useThreadBirth(args: {
  app: AtlasApp
  owner: SessionOwner<SessionRuntime>
  containerMove: ReturnType<typeof useContainerMove>
  createBridge: CloudBridgeFactory
  preflightLift?: LiftPreflight | undefined
  adopt: (opened: OpenedConversation) => void
  onReload: (reload: CloudReload) => Promise<void>
}): ThreadBirth {
  const latest = useRef(args)
  latest.current = args

  const liftNewborn = useCallback((liftArgs: { threadId: OpenedConversation['threadId'] }) => {
    const { app, containerMove: move, createBridge, owner } = latest.current
    const threadId = liftArgs.threadId
    const bridge = createBridge()
    const captureContext = () => app.captureContext({ cwd: app.workspace.workspace })

    void liftToCloud({
      threadId,
      cwd: app.workspace.workspace,
      started: false,
      midTurn: false,
      interrupt: () => undefined,
      whenSettled: () => Promise.resolve(),
      identity: app.workspace,
      title: null,
      model: storedModel(app.model.choice()),
      bridge,
      localThreads: app.threads,
      localLog: app.log,
      agents: app.agents,
      ids: app.ids,
      logPort: durableOpLog() ?? undefined,
      placement: owner,
      stopLocal: async () =>
        stopLocalWork({ threadId, shells: app.shells, services: app.services, threads: app.threads }),
      capture: () => Promise.resolve(null),
      captureContext,
      onBegin: ({ waves }) =>
        move.handleBegin({
          target: EExecutionLocation.Cloud,
          rows: waves.map((wave) => ({ id: wave.ids[0] ?? wave.label, text: wave.label, nodeIds: wave.ids })),
          heading: 'STARTING A CLOUD SANDBOX',
        }),
      onNodeStart: (nodeId) => move.handleNodeStart(nodeId),
      onNodeDone: (nodeId) => move.handleNodeDone(nodeId),
      onTransferProgress: move.handleTransferProgress,
      onWaveLabel: (nodeId, label) => move.handleRowLabel({ nodeId, text: label }),
      open: async ({ attachment, transaction, restoredWorkspace }) => {
        const runner = createCloudRunner({ bridge, channel: attachment.channel, threadId, captureContext, move })
        const base = { ...app, ...cloudRuntimeParts({ channel: attachment.channel, stores: attachment.stores, runner }) }
        const opened = await openCloudConversation({ app: base, threadId })
        const anchor = await cloudAnchorOf({ stores: attachment.stores, threadId, opened, restored: restoredWorkspace })
        const stopMirroring = mirrorCloudRenames({ home: app.threads, remote: attachment.stores.threads })
        const session = createCloudSession({
          channel: attachment.channel,
          sandboxes: bridge.sandboxes,
          onReload: latest.current.onReload,
          appliedSnapshot: () => cloudReadinessOf(attachment.channel).applied(),
          subscribeApplied: (listener) => cloudReadinessOf(attachment.channel).subscribe(listener),
          onParked: parkHookFor({ app, channel: attachment.channel }),
          onClose: () => {
            cloudReadinessOf(attachment.channel).cancelWaiting()
            stopMirroring()
          },
        })
        prepareOn({
          transaction,
          binding: cloudBindingOf({
            local: app,
            anchor,
            channel: attachment.channel,
            stores: attachment.stores,
            bridge,
            runner,
            opened,
            session,
          }),
        })
      },
    })
      .then((lifted) => {
        if (!lifted.ok) {
          const reason = liftFailedNotice(lifted)
          move.handleFail(reason)
          notify({ key: CLOUD_LIFT_NOTICE_KEY, text: reason, tone: ENoticeTone.Warn, ttlMs: NOTICE_WARN_MS })
          return
        }
        move.handleSettle()
      })
      .catch((error: unknown) => {
        const reason = `starting a cloud sandbox failed — ${messageOf(error)}`
        move.handleFail(reason)
        notify({ key: CLOUD_LIFT_NOTICE_KEY, text: reason, tone: ENoticeTone.Warn, ttlMs: NOTICE_WARN_MS })
      })
  }, [])

  const handleNewThread = useCallback(() => {
    const { app, containerMove } = latest.current
    if (containerMove.move !== null) return
    void bornWith({
      app,
      threadId: app.ids.nextThreadId(),
      preflightLift: latest.current.preflightLift,
      lift: liftNewborn,
      adopt: latest.current.adopt,
    }).catch((error: unknown) => {
      notify({
        key: 'born-cloud-failed',
        text: `a new thread could not be placed — ${messageOf(error)}`,
        tone: ENoticeTone.Warn,
        ttlMs: NOTICE_WARN_MS,
      })
    })
  }, [liftNewborn])

  return { handleNewThread }
}
