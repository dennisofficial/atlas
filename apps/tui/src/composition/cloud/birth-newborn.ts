import { EHarnessPlacement, ERunner, type ThreadId } from '@dltech/atlas-core'
import {
  birthInCloud,
  EBirthNode,
  storedModel,
  type CloudReload,
  type SessionOwner,
  type SessionRuntime,
} from '@dltech/atlas-harness'

import { ENoticeTone, NOTICE_WARN_MS, notify } from '../../ui/notice-store'
import type { AtlasApp } from '../compose'
import { durableOpLog } from '../durable-op-log'
import { messageOf } from '../error-text'
import { cloudAnchorOf, cloudBindingOf, prepareOn } from '../session-binding'
import type { ContainerMoveControl } from '../use-container-move'
import type { CloudBridgeFactory } from './bridge-factory'
import { bornPlacementChip, startsTheThread } from './born-placement-chip'
import { cloudRuntimeParts, openCloudConversation } from './cloud-app'
import { BIRTH_CANCELLED_NOTICE, CLOUD_BIRTH_NOTICE_KEY, birthFailedNotice } from './cloud-birth-notices'
import { cloudReadinessOf } from './cloud-readiness'
import { createCloudRunner, createCloudWake } from './cloud-runner'
import { createCloudSession } from './cloud-session'
import { mirrorCloudRenames } from './rename-mirror'

const POD_PROVISION_LABEL = 'starting the pod — the first one pulls a 5.5 GB image'

const warn = (text: string): void =>
  notify({ key: CLOUD_BIRTH_NOTICE_KEY, text, tone: ENoticeTone.Warn, ttlMs: NOTICE_WARN_MS })

export function birthNewborn(args: {
  app: AtlasApp
  owner: SessionOwner<SessionRuntime>
  move: ContainerMoveControl
  createBridge: CloudBridgeFactory
  threadId: ThreadId
  runner: ERunner
  onReload: (reload: CloudReload) => Promise<void>
  onRestoreDraft: () => void
  onRelease: () => void
}): void {
  const { app, move, owner, threadId, runner } = args
  const pod = runner === ERunner.Local
  const bridge = args.createBridge({ runner })
  let cancelled = false
  const destroySandbox = (): Promise<void> => bridge.sandboxes.destroy({ threadId }).catch(() => undefined)
  const failed = async (reason: string): Promise<void> => {
    await destroySandbox()
    move.handleFail(reason)
    warn(reason)
    args.onRestoreDraft()
    args.onRelease()
  }
  const settleCancelled = async (): Promise<void> => {
    await destroySandbox()
    args.onRelease()
  }
  const handleCancel = (): void => {
    cancelled = true
    warn(BIRTH_CANCELLED_NOTICE)
    args.onRestoreDraft()
  }
  const captureContext = () => app.captureContext({ cwd: app.workspace.workspace })

  void birthInCloud({
    threadId,
    runner,
    cwd: app.workspace.workspace,
    identity: app.workspace,
    model: storedModel(app.model.choice()),
    bridge,
    localThreads: app.threads,
    localLog: app.log,
    ids: app.ids,
    logPort: durableOpLog() ?? undefined,
    placement: owner,
    captureContext,
    onBegin: ({ waves }) =>
      move.handleBegin({
        rows: waves.map((wave) => ({
          id: wave.ids[0] ?? wave.label,
          text: pod && wave.ids[0] === EBirthNode.Provision ? POD_PROVISION_LABEL : wave.label,
          nodeIds: wave.ids,
        })),
        heading: pod ? 'STARTING A POD' : 'STARTING A CLOUD SANDBOX',
        onCancel: handleCancel,
      }),
    onNodeStart: (nodeId) => move.handleNodeStart(nodeId),
    onNodeDone: (nodeId) => move.handleNodeDone(nodeId),
    onTransferProgress: (progress) => move.handleTransferProgress({ ...progress, nodeId: EBirthNode.Provision }),
    onWaveLabel: (nodeId, label) => move.handleRowLabel({ nodeId, text: label }),
    open: async ({ attachment, prepareRuntime }) => {
      if (cancelled) throw new Error(BIRTH_CANCELLED_NOTICE)
      const stopWatching = attachment.channel.subscribe({
        threadId,
        listener: (signal) => {
          if (!startsTheThread(signal)) return
          stopWatching()
          bornPlacementChip(app).retire(threadId)
        },
      })
      const wake = createCloudWake({ bridge, channel: attachment.channel, threadId, captureContext, move })
      const turns = createCloudRunner({ bridge, channel: attachment.channel, threadId, captureContext, move, wake })
      const base = { ...app, ...cloudRuntimeParts({ channel: attachment.channel, stores: attachment.stores, runner: turns }) }
      const opened = await openCloudConversation({ app: base, threadId })
      const anchor = await cloudAnchorOf({ stores: attachment.stores, threadId, opened })
      if (cancelled) throw new Error(BIRTH_CANCELLED_NOTICE)
      const stopMirroring = mirrorCloudRenames({ home: app.threads, remote: attachment.stores.threads })
      const session = createCloudSession({
        channel: attachment.channel,
        sandboxes: bridge.sandboxes,
        wake: () => wake({ quiet: true }),
        onReload: args.onReload,
        appliedSnapshot: () => cloudReadinessOf(attachment.channel).applied(),
        subscribeApplied: (listener) => cloudReadinessOf(attachment.channel).subscribe(listener),
        onClose: () => {
          cloudReadinessOf(attachment.channel).cancelWaiting()
          stopMirroring()
        },
      })
      prepareOn({
        prepareRuntime,
        binding: cloudBindingOf({
          local: app,
          anchor,
          channel: attachment.channel,
          stores: attachment.stores,
          bridge,
          runner: turns,
          opened,
          session,
          sessionMirror: attachment.sessionMirror,
        }),
      })
    },
  })
    .then((born) => {
      if (cancelled) return settleCancelled()
      if (!born.ok) return failed(birthFailedNotice(born))
      const chip = bornPlacementChip(app)
      const held = chip.snapshot()
      const arrival = held?.threadId === threadId ? held.arrival : undefined
      chip.set({ threadId, harness: EHarnessPlacement.Cloud, runner, provisioning: false, arrival })
      move.handleSettle()
    })
    .catch((error: unknown) => {
      if (cancelled) return settleCancelled()
      return failed(`${pod ? 'starting the pod' : 'starting a cloud sandbox'} failed — ${messageOf(error)}`)
    })
}
