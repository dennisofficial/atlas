import type { ThreadId } from '@dltech/atlas-core'

import { createRemoteDeltaChannel } from './remote-delta-channel'
import { RemoteSessionActivity } from '../activity/remote-session-activity'
import { RemoteEventLog } from './remote-event-log'
import { RemoteThreadStore } from './remote-thread-store'
import { RemoteTurnLedger } from './remote-turn-ledger'
import type { CloudBridge, CloudSandboxes } from './cloud-bridge'

export type AttachOptions = {
  /**
   * The newest durable event seq the client holds for a thread, reported on the Hello so the serve
   * can vouch the log is current. The truthful source is the local event store, so a Promise is
   * honoured. Absent means the client can never be vouched current.
   */
  lastEventSeq?: ((args: { threadId: ThreadId }) => number | Promise<number>) | undefined
  projectIdOf?: ((args: { threadId: ThreadId }) => Promise<string | null>) | undefined
}

export const attachmentOf =
  (args: { options: AttachOptions; sandboxes: CloudSandboxes }): CloudBridge['attach'] =>
  ({
    threadId,
    url,
    token,
    sandboxThreadId,
  }: {
    threadId: ThreadId
    url?: string | undefined
    token?: string | undefined
    sandboxThreadId?: ThreadId | undefined
  }) => {
    const { options, sandboxes } = args
    const hosted = sandboxThreadId ?? threadId
    const channel = createRemoteDeltaChannel({
      threadId,
      ...(url === undefined || token === undefined ? { readsWake: false } : { url, token }),
      ...(options.lastEventSeq === undefined
        ? {}
        : { lastEventSeq: () => options.lastEventSeq?.({ threadId }) ?? 0 }),
      wakeSandbox: async ({ onRotationStarted }) => {
        const projectId =
          (await options.projectIdOf?.({ threadId: hosted }).catch(() => null)) ?? null
        const { url: woken, token: minted } = await sandboxes.create({
          threadId: hosted,
          projectId,
          onRotationStarted,
        })
        return { url: woken, token: minted }
      },
    })
    return {
      channel,
      stores: {
        log: new RemoteEventLog({ channel }),
        threads: new RemoteThreadStore({ channel }),
        ledger: new RemoteTurnLedger({ channel }),
        activity: new RemoteSessionActivity({ channel }),
      },
    }
  }
