import { useCallback, useEffect, useRef } from 'react'

import { EExecutionLocation, EHarnessPlacement } from '@dltech/atlas-core'
import {
  birthInCloud,
  EBirthNode,
  storedModel,
  type CloudReload,
  type SessionOwner,
  type SessionRuntime,
} from '@dltech/atlas-harness'

import { ENoticeTone, NOTICE_WARN_MS, notify } from '../ui/notice-store'
import { bornWith, fallBackToHost, rememberPlacement } from './cloud/born-cloud'
import { bornPlacementChip, startsTheThread } from './cloud/born-placement-chip'
import { cloudRuntimeParts, openCloudConversation } from './cloud/cloud-app'
import { cloudReadinessOf } from './cloud/cloud-readiness'
import { CLOUD_BIRTH_NOTICE_KEY, birthFailedNotice } from './cloud/cloud-birth-notices'
import { createCloudRunner, createCloudWake } from './cloud/cloud-runner'
import { createCloudSession } from './cloud/cloud-session'
import { mirrorCloudRenames } from './cloud/rename-mirror'
import type { AtlasApp } from './compose'
import { durableOpLog } from './durable-op-log'
import { messageOf } from './error-text'
import type { OpenedConversation } from './open-conversation'
import { cloudAnchorOf, cloudBindingOf, prepareOn } from './session-binding'
import type { CloudBridgeFactory, BirthPreflight } from './cloud/bridge-factory'
import type { useContainerMove } from './use-container-move'

export type ThreadBirth = {
  handleNewThread: () => void
  handleFlipPlacement: () => void
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
  preflightBirth?: BirthPreflight | undefined
  adopt: (opened: OpenedConversation) => void
  onReload: (reload: CloudReload) => Promise<void>
}): ThreadBirth {
  const latest = useRef(args)
  latest.current = args
  const birthCloudRef = useRef<(born: { threadId: OpenedConversation['threadId'] }) => void>(() => undefined)

  const birthArgs = useCallback(
    (born: {
      threadId: OpenedConversation['threadId']
      choice?: EHarnessPlacement | undefined
      carriedDraft?: boolean | undefined
    }) => ({
      app: latest.current.app,
      threadId: born.threadId,
      ...(born.choice === undefined ? {} : { choice: born.choice }),
      ...(born.carriedDraft === true ? { carriedDraft: true } : {}),
      preflightBirth: latest.current.preflightBirth,
      birthCloud: (born: { threadId: OpenedConversation['threadId'] }) => birthCloudRef.current(born),
      adopt: latest.current.adopt,
    }),
    [],
  )

  const birthNewborn = useCallback((born: { threadId: OpenedConversation['threadId'] }) => {
    const { app, containerMove: move, createBridge, owner } = latest.current
    const threadId = born.threadId
    const bridge = createBridge()
    const captureContext = () => app.captureContext({ cwd: app.workspace.workspace })

    void birthInCloud({
      threadId,
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
          target: EExecutionLocation.Cloud,
          rows: waves.map((wave) => ({ id: wave.ids[0] ?? wave.label, text: wave.label, nodeIds: wave.ids })),
          heading: 'STARTING A CLOUD SANDBOX',
          onCancel: () => fallBackToHost(birthArgs({ threadId })),
        }),
      onNodeStart: (nodeId) => move.handleNodeStart(nodeId),
      onNodeDone: (nodeId) => move.handleNodeDone(nodeId),
      onTransferProgress: (progress) =>
        move.handleTransferProgress({ ...progress, nodeId: EBirthNode.Provision }),
      onWaveLabel: (nodeId, label) => move.handleRowLabel({ nodeId, text: label }),
      open: async ({ attachment, prepareRuntime }) => {
        const stopWatching = attachment.channel.subscribe({
          threadId,
          listener: (signal) => {
            if (!startsTheThread(signal)) return
            stopWatching()
            bornPlacementChip(app).retire(threadId)
          },
        })
        const wake = createCloudWake({ bridge, channel: attachment.channel, threadId, captureContext, move })
        const runner = createCloudRunner({ bridge, channel: attachment.channel, threadId, captureContext, move, wake })
        const base = { ...app, ...cloudRuntimeParts({ channel: attachment.channel, stores: attachment.stores, runner }) }
        const opened = await openCloudConversation({ app: base, threadId })
        const anchor = await cloudAnchorOf({ stores: attachment.stores, threadId, opened })
        const stopMirroring = mirrorCloudRenames({ home: app.threads, remote: attachment.stores.threads })
        const session = createCloudSession({
          channel: attachment.channel,
          sandboxes: bridge.sandboxes,
          wake: () => wake({ quiet: true }),
          onReload: latest.current.onReload,
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
            runner,
            opened,
            session,
            sessionMirror: attachment.sessionMirror,
          }),
        })
      },
    })
      .then(async (born) => {
        if (!born.ok) {
          const reason = birthFailedNotice(born)
          move.handleFail(reason)
          notify({ key: CLOUD_BIRTH_NOTICE_KEY, text: reason, tone: ENoticeTone.Warn, ttlMs: NOTICE_WARN_MS })
          fallBackToHost(birthArgs({ threadId }))
          return
        }
        bornPlacementChip(app).set({ threadId, harness: EHarnessPlacement.Cloud, provisioning: false })
        move.handleSettle()
      })
      .catch((error: unknown) => {
        const reason = `starting a cloud sandbox failed — ${messageOf(error)}`
        move.handleFail(reason)
        notify({ key: CLOUD_BIRTH_NOTICE_KEY, text: reason, tone: ENoticeTone.Warn, ttlMs: NOTICE_WARN_MS })
        fallBackToHost(birthArgs({ threadId }))
      })
  }, [])

  const birth = useCallback(
    (born: {
      threadId: OpenedConversation['threadId']
      choice?: EHarnessPlacement | undefined
      carriedDraft?: boolean | undefined
    }) => {
      void bornWith(birthArgs(born)).catch((error: unknown) => {
        notify({
          key: 'born-cloud-failed',
          text: `a new thread could not be placed — ${messageOf(error)}`,
          tone: ENoticeTone.Warn,
          ttlMs: NOTICE_WARN_MS,
        })
      })
    },
    [birthArgs],
  )

  birthCloudRef.current = birthNewborn

  const handleNewThread = useCallback(() => {
    const { app, containerMove } = latest.current
    if (containerMove.move !== null) return
    birth({ threadId: app.ids.nextThreadId() })
  }, [birth])

  const handleFlipPlacement = useCallback(() => {
    const { app, containerMove } = latest.current
    const state = bornPlacementChip(app).snapshot()
    if (state === null || state.provisioning || containerMove.move !== null) return
    const choice = state.harness === EHarnessPlacement.Cloud ? EHarnessPlacement.Host : EHarnessPlacement.Cloud
    rememberPlacement({ app, harness: choice })
    if (choice === EHarnessPlacement.Cloud) {
      birth({ threadId: state.threadId, choice })
      return
    }
    void latest.current
      .createBridge()
      .sandboxes.destroy({ threadId: state.threadId })
      .catch(() => undefined)
    birth({ threadId: app.ids.nextThreadId(), choice, carriedDraft: true })
  }, [birth])

  useEffect(
    () => bornPlacementChip(latest.current.app).bindFlip(handleFlipPlacement),
    [handleFlipPlacement],
  )

  return { handleNewThread, handleFlipPlacement }
}
