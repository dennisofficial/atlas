import { useCallback, useEffect, useRef } from 'react'

import { EExecutionLocation, EHarnessPlacement, ERunner } from '@dltech/atlas-core'
import {
  birthInCloud,
  cloudProvisioningConfigured,
  EBirthNode,
  storedModel,
  type CloudReload,
  type SessionOwner,
  type SessionRuntime,
} from '@dltech/atlas-harness'

import { ENoticeTone, NOTICE_WARN_MS, notify } from '../ui/notice-store'
import { bornWith, CLOUD_NOT_CONFIGURED_NOTICE, fallBackToHost, rememberPlacement } from './cloud/born-cloud'
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

const POD_PROVISION_LABEL = 'starting the pod — the first one pulls a 5.5 GB image'

export type ThreadBirth = {
  handleNewThread: () => void
  handleFlipPlacement: () => void
}

export function useThreadBirth(args: {
  app: AtlasApp
  owner: SessionOwner<SessionRuntime>
  containerMove: ReturnType<typeof useContainerMove>
  createBridge: CloudBridgeFactory
  preflightBirth?: BirthPreflight | undefined
  onSignInRequired: () => void
  adopt: (opened: OpenedConversation) => void
  onReload: (reload: CloudReload) => Promise<void>
}): ThreadBirth {
  const latest = useRef(args)
  latest.current = args
  const birthCloudRef = useRef<(born: { threadId: OpenedConversation['threadId']; runner: ERunner }) => void>(
    () => undefined,
  )

  const birthArgs = useCallback(
    (born: {
      threadId: OpenedConversation['threadId']
      choice?: ERunner | undefined
      carriedDraft?: boolean | undefined
    }) => ({
      app: latest.current.app,
      threadId: born.threadId,
      ...(born.choice === undefined ? {} : { choice: born.choice }),
      ...(born.carriedDraft === true ? { carriedDraft: true } : {}),
      preflightBirth: latest.current.preflightBirth,
      requireSignIn: () => latest.current.onSignInRequired(),
      birthCloud: (next: { threadId: OpenedConversation['threadId']; runner: ERunner }) =>
        birthCloudRef.current(next),
      adopt: latest.current.adopt,
    }),
    [],
  )

  const birthNewborn = useCallback((born: { threadId: OpenedConversation['threadId']; runner: ERunner }) => {
    const { app, containerMove: move, createBridge, owner } = latest.current
    const { threadId, runner } = born
    const pod = runner === ERunner.Local
    const bridge = createBridge({ runner })
    const failed = (reason: string): void => {
      if (pod) void bridge.sandboxes.destroy({ threadId }).catch(() => undefined)
      move.handleFail(reason)
      notify({ key: CLOUD_BIRTH_NOTICE_KEY, text: reason, tone: ENoticeTone.Warn, ttlMs: NOTICE_WARN_MS })
      fallBackToHost(birthArgs({ threadId }))
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
          target: EExecutionLocation.Cloud,
          rows: waves.map((wave) => ({
            id: wave.ids[0] ?? wave.label,
            text: pod && wave.ids[0] === EBirthNode.Provision ? POD_PROVISION_LABEL : wave.label,
            nodeIds: wave.ids,
          })),
          heading: pod ? 'STARTING A POD' : 'STARTING A CLOUD SANDBOX',
          onCancel: () => {
            if (pod) void bridge.sandboxes.destroy({ threadId }).catch(() => undefined)
            fallBackToHost(birthArgs({ threadId }))
          },
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
          failed(birthFailedNotice(born))
          return
        }
        bornPlacementChip(app).set({ threadId, harness: EHarnessPlacement.Cloud, runner, provisioning: false })
        move.handleSettle()
      })
      .catch((error: unknown) => {
        failed(`${pod ? 'starting the pod' : 'starting a cloud sandbox'} failed — ${messageOf(error)}`)
      })
  }, [])

  const birth = useCallback(
    (born: {
      threadId: OpenedConversation['threadId']
      choice?: ERunner | undefined
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
    const { app, containerMove, createBridge } = latest.current
    const state = bornPlacementChip(app).snapshot()
    if (state === null || state.provisioning || containerMove.move !== null) return
    if (state.harness === EHarnessPlacement.Host) {
      rememberPlacement({ app, harness: EHarnessPlacement.Cloud })
      birth({ threadId: state.threadId, choice: ERunner.Local })
      return
    }
    const old = state.runner === ERunner.Vercel ? ERunner.Vercel : ERunner.Local
    const next = old === ERunner.Local ? ERunner.Vercel : ERunner.Local
    if (next === ERunner.Vercel && !cloudProvisioningConfigured({ settings: app.settings, secrets: app.secrets })) {
      notify({
        key: 'born-cloud-unconfigured',
        text: CLOUD_NOT_CONFIGURED_NOTICE,
        tone: ENoticeTone.Info,
        ttlMs: NOTICE_WARN_MS,
      })
      return
    }
    if (app.cloud.session() === null) {
      birth({ threadId: state.threadId, choice: next })
      return
    }
    void (latest.current.preflightBirth?.({ runner: next }) ?? Promise.resolve(null)).then((refusal) => {
      if (refusal !== null) {
        notify({ key: 'born-cloud-preflight', text: refusal, tone: ENoticeTone.Warn, ttlMs: NOTICE_WARN_MS })
        return
      }
      rememberPlacement({ app, harness: EHarnessPlacement.Cloud })
      void createBridge({ runner: old })
        .sandboxes.destroy({ threadId: state.threadId })
        .catch(() => undefined)
      birth({ threadId: app.ids.nextThreadId(), choice: next, carriedDraft: true })
    })
  }, [birth])

  useEffect(
    () => bornPlacementChip(latest.current.app).bindFlip(handleFlipPlacement),
    [handleFlipPlacement],
  )

  return { handleNewThread, handleFlipPlacement }
}
