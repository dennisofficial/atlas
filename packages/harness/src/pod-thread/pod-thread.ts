import type { Event, NoticePort, ThreadId, WorkspaceIdentity } from '@dltech/atlas-core'

import type {
  CloudAttachment,
  CloudBridge,
  CloudChannel,
  CloudReload,
  CloudStores,
} from '../cloud/cloud-bridge'
import type { RemoteTurnRunner } from '../cloud/remote-turn-runner'
import type { ContextReader } from '../files/session-context'
import type { ThreadStorePort } from '../store/thread-store'
import { createPodSession, type PodReadiness, type PodSession } from './pod-session'
import {
  podAnchorOf,
  podContextOf,
  podRuntimeParts,
  type PodRuntimeParts,
  type PodSurfaceReaders,
} from './pod-runtime'
import { podFailureReasonOf } from './pod-failure'
import { createPodRunner, createPodWake, wakePod, type PodWakeNarration } from './pod-wake'
import { createLocalPodTitles } from './local-pod-titles'
import { LocalPodThreadStore } from './local-pod-thread-store'
import { EConnectionView } from '../cloud/connection-view'
import { startPodLocalCopy, type LocalCopyHome } from './local-copy'
import { mirrorPodRenames } from './rename-mirror'

/** One thread whose loop runs in a pod, attached and ready to bind. Independent of every other. */
export type PodThread<Opened> = {
  threadId: ThreadId
  attachment: CloudAttachment
  runner: RemoteTurnRunner
  runtime: PodRuntimeParts
  opened: Opened
  anchor: WorkspaceIdentity
  context: ContextReader
  session: PodSession
  settleOpen: () => void
  close: () => void
  /** Resolves once the local copy has finished any write in flight; immediate without a copy. */
  copySettled: () => Promise<void>
}

type Transcript = { events: readonly Event[] }

/** The surface's own thread store: where the pod's project is looked up and its renames land. */
export type PodHome = Pick<ThreadStorePort, 'rename'> & {
  find(args: { threadId: ThreadId }): Promise<{ projectId?: string | null | undefined } | undefined>
}

export type PodThreadPorts<Opened extends Transcript> = {
  bridge: CloudBridge
  threadId: ThreadId
  home: PodHome
  notice: NoticePort
  onReload: (reload: CloudReload) => Promise<void>
  open: (runtime: PodRuntimeParts) => Promise<Opened>
  readinessOf?: ((channel: CloudChannel) => PodReadiness) | undefined
  onSurfaceReaders?: ((readers: PodSurfaceReaders) => void) | undefined
  wakeNarration?: PodWakeNarration | undefined
  /** Keeps the pod's events, title and model in the home session files while attached. */
  localCopy?: { home: string; threads: LocalCopyHome; log?: CloudStores['log'] } | undefined
}

const ALREADY_SETTLED = (): void => undefined

export async function assemblePodThread<Opened extends Transcript>(
  args: PodThreadPorts<Opened> & {
    attachment: CloudAttachment
    projectId: string | null
    assertStillWanted?: (() => void) | undefined
    transcript?: CloudStores | undefined
  },
): Promise<PodThread<Opened>> {
  const { attachment, threadId } = args
  const { channel, stores } = attachment
  const wake = createPodWake({
    bridge: args.bridge,
    channel,
    threadId,
    projectId: args.projectId,
    narration: args.wakeNarration,
  })
  const runner = createPodRunner({
    bridge: args.bridge,
    channel,
    threadId,
    projectId: args.projectId,
    wake,
  })
  const titles =
    args.localCopy === undefined
      ? undefined
      : createLocalPodTitles({
          home: args.localCopy.home,
          threadId,
          channel: () => channel,
        })
  const runtimeStores =
    titles === undefined || args.localCopy === undefined
      ? stores
      : {
          ...stores,
          threads: new LocalPodThreadStore({
            channel,
            home: args.localCopy.threads,
            log: args.localCopy.log ?? args.transcript?.log ?? stores.log,
            titles,
          }),
        }
  const runtime = podRuntimeParts({
    channel,
    stores: runtimeStores,
    runner,
    notice: args.notice,
    onSurfaceReaders: args.onSurfaceReaders,
  })
  const transcript = args.transcript ?? runtimeStores
  const opened = await args.open({ ...runtime, ...transcript })
  const anchor = await podAnchorOf({ stores: transcript, threadId, events: opened.events })
  args.assertStillWanted?.()
  const titleStops =
    titles === undefined
      ? []
      : [
          channel.onReady(() => titles.reconcile()),
          channel.onThreadRenamed((renamed) => {
            if (renamed.threadId === threadId) titles.observe({ title: renamed.title })
          }),
        ]
  if (titles !== undefined && channel.connection().state === EConnectionView.Connected)
    titles.reconcile()
  const stopMirroring =
    titles === undefined
      ? mirrorPodRenames({ home: args.home, remote: stores.threads })
      : () => {
          for (const off of titleStops) off()
          titles.stop()
        }
  const session = createPodSession({
    channel,
    sandboxes: args.bridge.sandboxes,
    messages: args.bridge.messages,
    ...(args.bridge.api === undefined ? {} : { api: args.bridge.api }),
    wake,
    onReload: args.onReload,
    notice: args.notice,
    readiness: args.readinessOf?.(channel),
    onClose: () => {
      stopMirroring()
      copy?.stop()
    },
  })
  const copy =
    args.localCopy === undefined
      ? undefined
      : startPodLocalCopy({
          home: args.localCopy.home,
          threadId,
          channel,
          remote: stores,
          homeThreads: args.localCopy.threads,
        })
  return {
    threadId,
    attachment: { ...attachment, stores: runtimeStores },
    runner,
    runtime,
    opened,
    anchor,
    context: podContextOf({ channel, threadId }),
    session,
    settleOpen: ALREADY_SETTLED,
    close: session.close,
    copySettled: async () => {
      await copy?.settled()
      await titles?.settled()
    },
  }
}

/** Opens a pod thread awake: the pod is woken before the channel attaches, so there is nothing left to settle. */
export async function openPodThread<Opened extends Transcript>(
  args: PodThreadPorts<Opened> & { openNarration?: PodWakeNarration | undefined },
): Promise<PodThread<Opened>> {
  try {
    const projectId = (await args.home.find({ threadId: args.threadId }))?.projectId ?? null
    const woken = await wakePod({
      bridge: args.bridge,
      threadId: args.threadId,
      projectId,
      narration: args.openNarration,
    })
    const attachment = args.bridge.attach({
      threadId: args.threadId,
      url: woken.url,
      token: woken.token,
    })
    const pod = await assemblePodThread({ ...args, attachment, projectId })
    args.openNarration?.settled()
    return pod
  } catch (error) {
    args.openNarration?.failed(podFailureReasonOf(error))
    throw error
  }
}
