import type { PodConnectReply } from '@dltech/atlas-wire'
import type { ThreadId } from '@dltech/atlas-core'

import type { CloudBridge } from './cloud-bridge'
import type { LocalCloudBridgeOptions } from './local-cloud-bridge-options'
import { createRemoteDeltaChannel, type SandboxWake } from './remote-delta-channel'
import { RemoteEventLog } from './remote-event-log'
import { RemoteThreadStore } from './remote-thread-store'
import { RemoteTurnLedger } from './remote-turn-ledger'

export type ApiPodAttachOptions = Pick<LocalCloudBridgeOptions, 'lastEventSeq'>

export type PodTicketSource = (args: { threadId: ThreadId }) => Promise<PodConnectReply>

export const apiPodWakeOf =
  (args: { ticketOf: PodTicketSource; hosted: ThreadId }): SandboxWake =>
  async () => {
    const ticket = await args.ticketOf({ threadId: args.hosted })
    return { url: ticket.url, token: ticket.token }
  }

export const apiPodAttachmentOf =
  (args: { options: ApiPodAttachOptions; ticketOf: PodTicketSource }): CloudBridge['attach'] =>
  ({ threadId, url, token, sandboxThreadId }) => {
    const { options, ticketOf } = args
    const hosted = sandboxThreadId ?? threadId
    const channel = createRemoteDeltaChannel({
      threadId,
      url,
      token,
      ...(options.lastEventSeq === undefined
        ? {}
        : { lastEventSeq: () => options.lastEventSeq?.({ threadId }) ?? 0 }),
      wakeSandbox: apiPodWakeOf({ ticketOf, hosted }),
    })
    return {
      channel,
      stores: {
        log: new RemoteEventLog({ channel }),
        threads: new RemoteThreadStore({ channel }),
        ledger: new RemoteTurnLedger({ channel }),
      },
    }
  }
