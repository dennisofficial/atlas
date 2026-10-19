import {
  EHarnessPlacement,
  EToolEnvironment,
  ERunner,
  ESettingId,
  type SessionPlacement,
  type ThreadId,
} from '@dltech/atlas-core'
import { cloudProvisioningConfigured } from '@dltech/atlas-harness'

import { ENoticeTone, NOTICE_WARN_MS, notify } from '../../ui/notice-store'
import type { AtlasApp } from '../compose'
import { unstartedConversation, type OpenedConversation } from '../open-conversation'
import { localAnchorOf, localBindingOf } from '../session-binding'
import type { BirthPreflight } from './bridge-factory'
import { bornPlacementChip, startsTheThread } from './born-placement-chip'

export const CLOUD_NOT_CONFIGURED_NOTICE =
  'cloud sandboxes are not configured yet — set up your Vercel account under settings (ctrl+o) › cloud'

export const SIGN_IN_TO_BIRTH_NOTICE =
  'sign in to Atlas Cloud to start a session — pods lease your model tokens and signing key from it'

export type BornCloudArgs = {
  app: AtlasApp
  threadId: ThreadId
  choice?: ERunner | undefined
  carriedDraft?: boolean | undefined
  preflightBirth?: BirthPreflight | undefined
  requireSignIn: () => void
  birthCloud: (args: { threadId: ThreadId; runner: ERunner }) => void
  adopt: (opened: OpenedConversation) => void
}

const HOST_PLACEMENT: SessionPlacement = { harness: EHarnessPlacement.Host, tools: EToolEnvironment.Host }

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
      if (held !== undefined && held.placement.harness === EHarnessPlacement.Cloud) return
      void app.sessionOwner.placement
        .placeAtCreation({ threadId, placement: HOST_PLACEMENT })
        .catch(() => undefined)
    },
  })
}

export function fallBackToHost(args: BornCloudArgs): void {
  bornPlacementChip(args.app).set({
    threadId: args.threadId,
    harness: EHarnessPlacement.Host,
    provisioning: false,
    ...(args.carriedDraft === true ? { carriedDraft: true } : {}),
  })
  placeOnFirstSend(args)
  adoptLocally(args)
}

export async function bornWith(args: BornCloudArgs): Promise<void> {
  const { app, threadId } = args

  if (app.cloud.session() === null) {
    notify({ key: 'born-sign-in', text: SIGN_IN_TO_BIRTH_NOTICE, tone: ENoticeTone.Warn, ttlMs: NOTICE_WARN_MS })
    args.requireSignIn()
    return
  }

  const runner = args.choice ?? ERunner.Local

  if (runner === ERunner.Vercel && !cloudProvisioningConfigured({ settings: app.settings, secrets: app.secrets })) {
    notify({
      key: 'born-cloud-unconfigured',
      text: CLOUD_NOT_CONFIGURED_NOTICE,
      tone: ENoticeTone.Info,
      ttlMs: NOTICE_WARN_MS,
    })
    return
  }

  const refusal = (await args.preflightBirth?.({ runner })) ?? null
  if (refusal !== null) {
    notify({ key: 'born-cloud-preflight', text: refusal, tone: ENoticeTone.Warn, ttlMs: NOTICE_WARN_MS })
    return
  }

  bornPlacementChip(app).set({
    threadId,
    harness: EHarnessPlacement.Cloud,
    runner,
    provisioning: true,
    ...(args.carriedDraft === true ? { carriedDraft: true } : {}),
  })
  const opened = unstartedConversation({ ids: app.ids, threadId })
  args.adopt(opened)
  args.birthCloud({ threadId, runner })
}
