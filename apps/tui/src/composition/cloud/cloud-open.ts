import type { ThreadId } from '@dltech/atlas-core'
import {
  type CloudBridge,
  type CloudChannel,
  type CloudReload,
  type CloudStores,
  type RemoteTurnRunner,
} from '@dltech/atlas-harness'

import type { AtlasApp } from '../compose'
import { messageOf } from '../error-text'
import type { OpenedConversation } from '../open-conversation'
import { cloudAnchorOf, cloudBindingOf, type Binding } from '../session-binding'
import type { BootBlockStore, BootNarration } from '../boot-block-store'
import type { ContainerMoveControl } from '../use-container-move'
import { cloudReadinessOf } from './cloud-readiness'
import { cloudRuntimeParts, openCloudConversation } from './cloud-app'
import { createCloudRunner, createCloudWake, wakeSandbox, type CloudWake } from './cloud-runner'
import { createCloudSession, type CloudSession } from './cloud-session'
import { mirrorCloudRenames } from './rename-mirror'

type OpenArgs = {
  app: AtlasApp
  bridge: CloudBridge
  threadId: ThreadId
  move?: ContainerMoveControl | undefined
  boot?: BootBlockStore | undefined
  onReload: (reload: CloudReload) => Promise<void>
}

type Composed = {
  channel: CloudChannel
  stores: CloudStores
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

const inlineNarrationFor = (args: ResolvedOpenArgs): BootNarration | undefined =>
  args.boot?.narrationFor({ threadId: args.threadId }) ?? args.move

async function composeEager(args: ResolvedOpenArgs): Promise<Composed> {
  const woken = await wakeSandbox(wakeNarrationFor(args))
  const { channel, stores } = args.bridge.attach({
    threadId: args.threadId,
    url: woken.url,
    token: woken.token,
  })
  return {
    channel,
    stores,
    wake: createCloudWake({
      ...wakeNarrationFor(args),
      move: inlineNarrationFor(args),
      channel,
    }),
    settleOpenOf: () => ALREADY_SETTLED,
    openAgainst: (runner) =>
      openCloudConversation({
        app: { ...args.app, ...cloudRuntimeParts({ channel, stores, runner }) },
        threadId: args.threadId,
      }),
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
    const composed = await composeEager(args)
    const { channel, stores } = composed

    const runner = createCloudRunner({
      ...wakeNarrationFor(args),
      move: inlineNarrationFor(args),
      channel,
      wake: composed.wake,
    })
    const opened = await composed.openAgainst(runner)
    const anchor = await cloudAnchorOf({ stores, threadId, opened })
    const stopMirroring = mirrorCloudRenames({ home: app.threads, remote: stores.threads })
    const session = createCloudSession({
      channel,
      sandboxes: bridge.sandboxes,
      wake: () => composed.wake(),
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
      settleOpen: composed.settleOpenOf(session),
    })
  } catch (error) {
    move?.handleFail(messageOf(error))
    throw error
  }
}
