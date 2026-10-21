import type { ThreadId } from '@dltech/atlas-core'
import {
  type CloudBridge,
  type CloudChannel,
  type CloudReload,
  type CloudStores,
  type RemoteTurnRunner,
  type SessionMirrorSync,
} from '@dltech/atlas-harness'

import type { AtlasApp } from '../compose'
import { messageOf } from '../error-text'
import type { OpenedConversation } from '../open-conversation'
import { cloudAnchorOf, cloudBindingOf, type Binding } from '../session-binding'
import type { ContainerMoveControl } from '../use-container-move'
import { cloudReadinessOf } from './cloud-readiness'
import { cloudRuntimeParts, openCloudConversation } from './cloud-app'
import { createCloudRunner, createCloudWake, wakeSandbox, type CloudWake } from './cloud-runner'
import { createCloudSession, type CloudSession } from './cloud-session'
import { parkedStoresOf } from './parked-stores'
import { mirrorCloudRenames } from './rename-mirror'

type OpenArgs = {
  app: AtlasApp
  bridge: CloudBridge
  threadId: ThreadId
  move?: ContainerMoveControl | undefined
  onReload: (reload: CloudReload) => Promise<void>
  /** Wake the sandbox before anything renders. Recovery settles on the live channel, so it needs this. */
  wakeFirst?: boolean | undefined
}

type Composed = {
  channel: CloudChannel
  stores: CloudStores
  sessionMirror: SessionMirrorSync | undefined
  wake: CloudWake
  settleOpenOf: (session: CloudSession) => () => void
  openAgainst: (runner: RemoteTurnRunner) => Promise<OpenedConversation>
}

type ResolvedOpenArgs = OpenArgs & { projectId: string | null }

const ALREADY_SETTLED = (): void => undefined

const wakeNarrationFor = (args: ResolvedOpenArgs) => ({
  bridge: args.bridge,
  threadId: args.threadId,
  projectId: args.projectId,
  ...(args.move === undefined ? {} : { move: args.move }),
})

async function composeEager(args: ResolvedOpenArgs): Promise<Composed> {
  const woken = await wakeSandbox(wakeNarrationFor(args))
  const { channel, stores, sessionMirror } = args.bridge.attach({
    threadId: args.threadId,
    url: woken.url,
    token: woken.token,
  })
  return {
    channel,
    stores,
    sessionMirror,
    wake: createCloudWake({ ...wakeNarrationFor(args), channel }),
    settleOpenOf: () => ALREADY_SETTLED,
    openAgainst: (runner) =>
      openCloudConversation({
        app: { ...args.app, ...cloudRuntimeParts({ channel, stores, runner }) },
        threadId: args.threadId,
      }),
  }
}

function composeRenderFirst(args: ResolvedOpenArgs & { opened: OpenedConversation }): Composed {
  const attachment = args.bridge.attach({ threadId: args.threadId })
  const { channel } = attachment
  const stores = parkedStoresOf({
    channel,
    local: { threads: args.app.threads, log: args.app.log, ledger: args.app.ledger },
    remote: attachment.stores,
  })
  return {
    channel,
    stores,
    sessionMirror: attachment.sessionMirror,
    wake: createCloudWake({ ...wakeNarrationFor(args), channel }),
    settleOpenOf: (session) => session.settleOpen,
    openAgainst: async () => args.opened,
  }
}

/**
 * Opening a thread that already lives in the cloud. When this machine holds a transcript worth
 * drawing — with the mirror, that is any cloud session whose local file survived — the
 * conversation opens from it at once against a channel that has not dialled yet, and the open
 * settles behind it: a sandbox whose lifecycle record says parked stays parked until the first
 * send, anything else wakes in the background. With nothing local to draw, or a half-finished
 * move that settles on the live channel, the wake comes first.
 */
export async function openCloudThread(openArgs: OpenArgs): Promise<Binding> {
  const { app, bridge, threadId, move } = openArgs

  try {
    const projectId = (await app.threads.find({ threadId }))?.projectId ?? null
    const args: ResolvedOpenArgs = { ...openArgs, projectId }
    const renderable = args.wakeFirst === true ? null : await renderableLocally(args)
    const composed =
      renderable === null
        ? await composeEager(args)
        : composeRenderFirst({ ...args, opened: renderable })
    const { channel, stores } = composed

    const runner = createCloudRunner({ ...wakeNarrationFor(args), channel, wake: composed.wake })
    const opened = await composed.openAgainst(runner)
    const anchor = await cloudAnchorOf({ stores, threadId, opened })
    const stopMirroring = mirrorCloudRenames({ home: app.threads, remote: stores.threads })
    const session = createCloudSession({
      channel,
      sandboxes: bridge.sandboxes,
      wake: () => composed.wake({ quiet: true }),
      onReload: args.onReload,
      appliedSnapshot: () => cloudReadinessOf(channel).applied(),
      subscribeApplied: (listener) => cloudReadinessOf(channel).subscribe(listener),
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
      sessionMirror: composed.sessionMirror,
      settleOpen: composed.settleOpenOf(session),
    })
  } catch (error) {
    move?.handleFail(messageOf(error))
    throw error
  }
}

async function renderableLocally(args: OpenArgs): Promise<OpenedConversation | null> {
  const { app, threadId } = args
  try {
    const placement = await app.threads.readPlacement({ threadId })
    if (placement === undefined) return null

    const opened = await openCloudConversation({ app, threadId })
    return opened.events.length === 0 ? null : opened
  } catch {
    return null
  }
}
