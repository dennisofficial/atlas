import type { Event, NoticePort, ThreadId, WorkspaceIdentity } from '@dltech/atlas-core'

import type { CloudAttachment, CloudBridge, CloudChannel, CloudReload } from '../cloud/cloud-bridge'
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
import {
  createPodRunner,
  createPodWake,
  podFailureReasonOf,
  wakePod,
  type PodWakeNarration,
} from './pod-wake'
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
  /** The open-time rule, run once the surface has adopted the thread. */
  settleOpen: () => void
  close: () => void
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
}

const ALREADY_SETTLED = (): void => undefined

export async function assemblePodThread<Opened extends Transcript>(
  args: PodThreadPorts<Opened> & {
    attachment: CloudAttachment
    projectId: string | null
    /** Throws to abandon the thread; asked once the transcript is read, before anything is held. */
    stillWanted?: (() => void) | undefined
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
  const runtime = podRuntimeParts({
    channel,
    stores,
    runner,
    notice: args.notice,
    onSurfaceReaders: args.onSurfaceReaders,
  })
  const opened = await args.open(runtime)
  const anchor = await podAnchorOf({ stores, threadId, events: opened.events })
  args.stillWanted?.()
  const stopMirroring = mirrorPodRenames({ home: args.home, remote: stores.threads })
  const session = createPodSession({
    channel,
    sandboxes: args.bridge.sandboxes,
    wake,
    onReload: args.onReload,
    notice: args.notice,
    readiness: args.readinessOf?.(channel),
    onClose: stopMirroring,
  })
  return {
    threadId,
    attachment,
    runner,
    runtime,
    opened,
    anchor,
    context: podContextOf({ channel, threadId }),
    session,
    settleOpen: session.settleOpen,
    close: session.close,
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
    return { ...pod, settleOpen: ALREADY_SETTLED }
  } catch (error) {
    args.openNarration?.failed(podFailureReasonOf(error))
    throw error
  }
}
