import {
  EHarnessPlacement,
  EToolEnvironment,
  type SessionPlacement,
  type ThreadId,
} from '@dltech/atlas-core'
import { bornPlacementFor } from '@dltech/atlas-harness'

import { ENoticeTone, NOTICE_WARN_MS, notify } from '../../ui/notice-store'
import type { AtlasApp } from '../compose'
import { unstartedConversation, type OpenedConversation } from '../open-conversation'
import { localAnchorOf, localBindingOf } from '../session-binding'

export const CLOUD_NOT_CONFIGURED_NOTICE =
  'cloud sandboxes are not configured yet — this thread was born on the host; set up your Vercel account under settings (ctrl+o) › cloud, and new threads will start in the cloud'

export type BornCloudArgs = {
  app: AtlasApp
  threadId: ThreadId
  preflightLift?: (() => Promise<string | null>) | undefined
  lift: (args: { threadId: ThreadId }) => void
  adopt: (opened: OpenedConversation) => void
}

const HOST_PLACEMENT: SessionPlacement = { harness: EHarnessPlacement.Host, tools: EToolEnvironment.Host }

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

/**
 * Where a /new thread is born. The placement is fixed at creation and never moves: a machine
 * that can provision sandboxes starts the thread in the cloud, and the provisioning itself is
 * the placement write — the thread simply has no history to transfer. The born marker lands
 * once the birth settles (`markBorn`), so a crash mid-provision still reads as an unfinished
 * birth to the recovery path. Anywhere else the thread is placed on the host immediately and
 * says why once.
 */
export async function bornWith(args: BornCloudArgs): Promise<void> {
  const { app, threadId } = args
  const owner = app.sessionOwner
  const placement = bornPlacementFor({ settings: app.settings, secrets: app.secrets })

  if (placement.harness === EHarnessPlacement.Host) {
    await owner.placement.placeAtCreation({ threadId, placement: HOST_PLACEMENT })
    notify({
      key: 'born-cloud-unconfigured',
      text: CLOUD_NOT_CONFIGURED_NOTICE,
      tone: ENoticeTone.Info,
      ttlMs: NOTICE_WARN_MS,
    })
    adoptLocally(args)
    return
  }

  const refusal = (await args.preflightLift?.()) ?? null
  if (refusal !== null) {
    await owner.placement.placeAtCreation({ threadId, placement: HOST_PLACEMENT })
    notify({ key: 'born-cloud-preflight', text: refusal, tone: ENoticeTone.Warn, ttlMs: NOTICE_WARN_MS })
    adoptLocally(args)
    return
  }

  const opened = unstartedConversation({ ids: app.ids, threadId })
  args.adopt(opened)
  args.lift({ threadId })
}
