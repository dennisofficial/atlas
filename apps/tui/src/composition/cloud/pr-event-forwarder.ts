import { EExecutionLocation, prEventBlock, type ThreadId } from '@dltech/atlas-core'
import {
  ECloudSandboxState,
  prEventNoticeOf,
  repoOfFrame,
  type CloudBridge,
  type CloudChannel,
  type PrEventFrame,
  type ThreadSummary,
} from '@dltech/atlas-harness'

/**
 * Forwards a pull-request event into a parked cloud conversation as ordinary input. The active
 * local session's own routing already consumes frames for the conversation it tracks; this exists
 * for the thread the operator lifted away, whose sandbox has no live process to receive the event
 * itself. The vehicle is `channel.send` — the same frame operator input travels on — because the
 * agent registry's `say` only ever reaches a roster child, never the conversation's main thread.
 *
 * The dedupe key is sandbox liveness, not focus: a running sandbox streams the same SSE feed and
 * its own session consumes the frame natively, so forwarding while it runs would land the event
 * twice. Forward only when the sandbox is not Running — parked, stopped, unknown, or simply gone.
 * The API replays `pr-state` on reconnect but never `pr-event`, so a woken sandbox does not
 * re-receive what was forwarded to it.
 */
export type PrEventForwarder = {
  onPrEvent(frame: PrEventFrame): Promise<void>
}

export function createPrEventForwarder(args: {
  /** The merged local+cloud listing, so a cloud-only thread's stub row (with its wire pullRequests) resolves. */
  listThreads: (args: { project: string }) => Promise<readonly ThreadSummary[]>
  project: string
  bridge: () => CloudBridge
  activeThreadId: () => ThreadId | undefined
}): PrEventForwarder {
  const channels = new Map<ThreadId, CloudChannel>()

  const channelFor = (threadId: ThreadId): CloudChannel => {
    const held = channels.get(threadId)
    if (held !== undefined) return held
    const attached = args.bridge().attach({ threadId })
    channels.set(threadId, attached.channel)
    return attached.channel
  }

  const cloudThreadsWatching = async (frame: PrEventFrame): Promise<readonly ThreadId[]> => {
    const repo = repoOfFrame(frame)
    const listed = await args.listThreads({ project: args.project }).catch(() => [])
    const active = args.activeThreadId()

    return listed
      .filter(
        (summary) =>
          summary.executionLocation === EExecutionLocation.Cloud &&
          summary.id !== active &&
          (summary.pullRequests ?? []).some(
            (link) => link.repo === repo && link.number === frame.prNumber,
          ),
      )
      .map((summary) => summary.id)
  }

  const parkedOrGone = async (threadId: ThreadId): Promise<boolean> => {
    const status = await args.bridge().sandboxes.find({ threadId }).catch(() => undefined)
    return status?.state !== ECloudSandboxState.Running
  }

  return {
    async onPrEvent(frame) {
      const targets = await cloudThreadsWatching(frame)
      const text = prEventBlock(prEventNoticeOf(frame))

      for (const threadId of targets) {
        if (!(await parkedOrGone(threadId))) continue
        try {
          channelFor(threadId).send({ text })
        } catch {
          // A channel that refuses the frame is dropped, not retried: the next event re-attempts.
        }
      }
    },
  }
}
