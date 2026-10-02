import type { ThreadId } from '@dltech/atlas-core'
import {
  EParkedResume,
  type CloudBridge,
  type CloudChannel,
  type CloudReload,
  type CloudStores,
  type RemoteTurnRunner,
} from '@dltech/atlas-harness'

import { ENoticeTone, NOTICE_WARN_MS, notify } from '../../ui/notice-store'
import type { AtlasApp } from '../compose'
import { messageOf } from '../error-text'
import type { OpenedConversation } from '../open-conversation'
import { cloudAnchorOf, cloudBindingOf, type Binding } from '../session-binding'
import type { ContainerMoveControl } from '../use-container-move'
import { cloudReadinessOf } from './cloud-readiness'
import { cloudRuntimeParts, openCloudConversation } from './cloud-app'
import { createCloudRunner, createCloudWake, wakeSandbox, type CloudWake } from './cloud-runner'
import { createCloudSession } from './cloud-session'
import { CLOUD_REATTACH_NOTICE_KEY, reattachNotice } from './lift-notices'
import { parkHookFor } from './park-hook'
import { parkedStoresOf } from './parked-stores'
import { readParkedResume } from './parked-resume'
import { mirrorCloudRenames } from './rename-mirror'

export const CLOUD_WAKE_FAILED_NOTICE_KEY = 'cloud-wake-failed'

type OpenArgs = {
  app: AtlasApp
  bridge: CloudBridge
  threadId: ThreadId
  move?: ContainerMoveControl | undefined
  /** Where this thread lives on this machine, when it does — see cloud-runner.ts's wake. */
  projectDirectory?: string | undefined
  onReload: (reload: CloudReload) => Promise<void>
  /** Wake the sandbox before anything renders. Recovery settles on the live channel, so it needs this. */
  wakeFirst?: boolean | undefined
}

type Composed = {
  channel: CloudChannel
  stores: CloudStores
  wake: CloudWake
  created: () => boolean
  parkedResume: EParkedResume | undefined
  wakeInBackground: (() => void) | undefined
  openAgainst: (runner: RemoteTurnRunner) => Promise<OpenedConversation>
}

const captureContextFor = (args: OpenArgs) => () =>
  args.app.captureContext({ cwd: args.projectDirectory ?? args.app.workspace.workspace })

const wakeNarrationFor = (args: OpenArgs) => ({
  bridge: args.bridge,
  threadId: args.threadId,
  captureContext: captureContextFor(args),
  ...(args.move === undefined ? {} : { move: args.move }),
})

async function composeEager(args: OpenArgs): Promise<Composed> {
  const woken = await wakeSandbox(wakeNarrationFor(args))
  const { channel, stores } = args.bridge.attach({ threadId: args.threadId, url: woken.url, token: woken.token })
  return {
    channel,
    stores,
    wake: createCloudWake({ ...wakeNarrationFor(args), channel }),
    created: () => woken.created,
    parkedResume: undefined,
    wakeInBackground: undefined,
    openAgainst: (runner) =>
      openCloudConversation({
        app: { ...args.app, ...cloudRuntimeParts({ channel, stores, runner }) },
        threadId: args.threadId,
      }),
  }
}

function composeRenderFirst(args: OpenArgs & { opened: OpenedConversation; resume: EParkedResume }): Composed {
  const attachment = args.bridge.attach({ threadId: args.threadId })
  const { channel } = attachment
  let created = false
  const wake = createCloudWake({
    ...wakeNarrationFor(args),
    channel,
    onWoken: (woken) => {
      created = woken.created
    },
  })
  const stores = parkedStoresOf({
    channel,
    local: { threads: args.app.threads, log: args.app.log, ledger: args.app.ledger },
    remote: attachment.stores,
  })
  const wakeInBackground = (): void => {
    channel.beginWake()
    void wake({ quiet: true }).catch((error: unknown) => {
      notify({
        key: CLOUD_WAKE_FAILED_NOTICE_KEY,
        text: `the sandbox could not be woken — ${messageOf(error)}`,
        tone: ENoticeTone.Warn,
        ttlMs: NOTICE_WARN_MS,
      })
    })
  }
  return {
    channel,
    stores,
    wake,
    created: () => created,
    parkedResume: args.resume,
    wakeInBackground: args.resume === EParkedResume.Synced ? undefined : wakeInBackground,
    openAgainst: async () => args.opened,
  }
}

/**
 * Opening a thread that already lives in the cloud. When this machine holds a transcript worth
 * drawing, the conversation opens from it at once against a channel that has not dialled yet; the
 * park record decides whether that transcript is trusted (Synced: nothing wakes until the first
 * send) or drawn muted while the wake runs behind it (Behind or Unknown). With nothing local to
 * draw, or a half-finished move that settles on the live channel, the wake still comes first.
 */
export async function openCloudThread(args: OpenArgs): Promise<Binding> {
  const { app, bridge, threadId, move } = args
  let unready = (): void => undefined

  try {
    const renderable = args.wakeFirst === true ? null : await renderableLocally(args)
    const composed =
      renderable === null
        ? await composeEager(args)
        : composeRenderFirst({ ...args, opened: renderable.opened, resume: renderable.resume })
    const { channel, stores } = composed

    unready = channel.onReady((ready) => {
      unready()
      notify({
        key: CLOUD_REATTACH_NOTICE_KEY,
        text: reattachNotice({ created: composed.created(), turnInFlight: ready.turnInFlight }),
      })
    })

    const runner = createCloudRunner({ ...wakeNarrationFor(args), channel, wake: composed.wake })
    const opened = await composed.openAgainst(runner)
    const anchor = await cloudAnchorOf({ stores, threadId, opened })
    const stopMirroring = mirrorCloudRenames({ home: app.threads, remote: stores.threads })
    const session = createCloudSession({
      channel,
      sandboxes: bridge.sandboxes,
      onReload: args.onReload,
      appliedSnapshot: () => cloudReadinessOf(channel).applied(),
      subscribeApplied: (listener) => cloudReadinessOf(channel).subscribe(listener),
      parkedResume: composed.parkedResume,
      onParked: parkHookFor({ app, channel }),
      onClose: () => {
        cloudReadinessOf(channel).cancelWaiting()
        stopMirroring()
      },
    })

    move?.handleSettle()
    return cloudBindingOf({
      local: app,
      anchor,
      channel,
      stores,
      bridge,
      runner,
      opened,
      session,
      wakeInBackground: composed.wakeInBackground,
    })
  } catch (error) {
    unready()
    move?.handleFail(messageOf(error))
    throw error
  }
}

async function renderableLocally(
  args: OpenArgs,
): Promise<{ opened: OpenedConversation; resume: EParkedResume } | null> {
  const { app, threadId } = args
  try {
    const placement = await app.threads.readPlacement({ threadId })
    if (placement?.move != null) return null

    const opened = await openCloudConversation({ app, threadId })
    if (opened.events.length === 0) return null

    const resume = await readParkedResume({ threads: app.threads, threadId, identity: opened.identity })
    return { opened, resume }
  } catch {
    return null
  }
}
