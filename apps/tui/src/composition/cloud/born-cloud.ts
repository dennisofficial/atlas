import {
  choiceValueOf,
  EHarnessPlacement,
  EToolEnvironment,
  ESettingId,
  type SessionPlacement,
  type ThreadId,
} from '@dltech/atlas-core'
import { cloudProvisioningConfigured } from '@dltech/atlas-harness'

import { ENoticeTone, NOTICE_WARN_MS, notify } from '../../ui/notice-store'
import type { AtlasApp } from '../compose'
import { unstartedConversation, type OpenedConversation } from '../open-conversation'
import { localAnchorOf, localBindingOf } from '../session-binding'
import { bornPlacementChip, startsTheThread } from './born-placement-chip'

export const CLOUD_NOT_CONFIGURED_NOTICE =
  'cloud sandboxes are not configured yet — this thread was born on the host; set up your Vercel account under settings (ctrl+o) › cloud, and new threads will start in the cloud'

export type BornCloudArgs = {
  app: AtlasApp
  threadId: ThreadId
  choice?: EHarnessPlacement | undefined
  preflightLift?: (() => Promise<string | null>) | undefined
  lift: (args: { threadId: ThreadId }) => void
  adopt: (opened: OpenedConversation) => void
}

const HOST_PLACEMENT: SessionPlacement = { harness: EHarnessPlacement.Host, tools: EToolEnvironment.Host }

const LAST_AUTO = 'auto'

type BornChoice = { harness: EHarnessPlacement; unconfigured: boolean }

function bornChoiceOf(args: { app: AtlasApp; explicit: EHarnessPlacement | undefined }): BornChoice {
  const { app } = args
  const last = choiceValueOf({
    resolution: app.settings.snapshot().resolution,
    id: ESettingId.LastBornPlacement,
    fallback: LAST_AUTO,
  })
  const wanted =
    args.explicit ?? (last === EHarnessPlacement.Host ? EHarnessPlacement.Host : EHarnessPlacement.Cloud)
  if (wanted === EHarnessPlacement.Host) return { harness: EHarnessPlacement.Host, unconfigured: false }
  if (cloudProvisioningConfigured({ settings: app.settings, secrets: app.secrets })) {
    return { harness: EHarnessPlacement.Cloud, unconfigured: false }
  }
  return { harness: EHarnessPlacement.Host, unconfigured: true }
}

export function rememberPlacement(args: { app: AtlasApp; harness: EHarnessPlacement }): void {
  args.app.settings.set({ id: ESettingId.LastBornPlacement, value: args.harness })
}

const adoptLocally = (args: BornCloudArgs): void => {
  const opened = unstartedConversation({ ids: args.app.ids, threadId: args.threadId })
  args.adopt(opened)
  void args.app.sessionOwner
    .activateLocal({
      threadId: args.threadId,
      binding: localBindingOf({
        local: args.app,
        workspace: localAnchorOf({ local: args.app, opened }),
        opened,
      }),
    })
    .catch(() => undefined)
}

function placeOnFirstSend(args: BornCloudArgs): void {
  const { app, threadId } = args
  const stop = app.channel.subscribe({
    threadId,
    listener: (signal) => {
      if (!startsTheThread(signal)) return
      stop()
      bornPlacementChip(app).retire(threadId)
      const held = app.sessionOwner.placement.snapshot(threadId)
      if (held !== undefined && (held.move !== null || held.placement.harness === EHarnessPlacement.Cloud)) return
      void app.sessionOwner.placement
        .placeAtCreation({ threadId, placement: HOST_PLACEMENT })
        .catch(() => undefined)
    },
  })
}

export function fallBackToHost(args: BornCloudArgs): void {
  bornPlacementChip(args.app).set({ threadId: args.threadId, harness: EHarnessPlacement.Host, provisioning: false })
  placeOnFirstSend(args)
  adoptLocally(args)
}

/**
 * Where a /new thread is born. The placement is fixed at the first send and never moves after it:
 * the operator's chip choice (else the last one, else the cloud when this machine can provision
 * sandboxes) decides it. Choosing the cloud starts provisioning right away — the provisioning is
 * the placement write, and the thread has no history to transfer. The born marker lands once the
 * birth settles (`markBorn`), so a crash mid-provision still reads as an unfinished birth to the
 * recovery path. Anywhere else the thread runs on the host and, when the cloud was wanted but is
 * not set up, says why once.
 */
export async function bornWith(args: BornCloudArgs): Promise<void> {
  const { app, threadId } = args
  const choice = bornChoiceOf({ app, explicit: args.choice })

  if (choice.harness === EHarnessPlacement.Host) {
    if (choice.unconfigured) {
      notify({
        key: 'born-cloud-unconfigured',
        text: CLOUD_NOT_CONFIGURED_NOTICE,
        tone: ENoticeTone.Info,
        ttlMs: NOTICE_WARN_MS,
      })
    }
    fallBackToHost(args)
    return
  }

  const refusal = (await args.preflightLift?.()) ?? null
  if (refusal !== null) {
    notify({ key: 'born-cloud-preflight', text: refusal, tone: ENoticeTone.Warn, ttlMs: NOTICE_WARN_MS })
    fallBackToHost(args)
    return
  }

  bornPlacementChip(app).set({ threadId, harness: EHarnessPlacement.Cloud, provisioning: true })
  const opened = unstartedConversation({ ids: app.ids, threadId })
  args.adopt(opened)
  args.lift({ threadId })
}
