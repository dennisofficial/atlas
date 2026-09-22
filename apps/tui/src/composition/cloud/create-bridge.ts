import type { ThreadId } from '@dltech/atlas-core'
import {
  cloudRequest,
  createRemoteDeltaChannel,
  ECloudSandboxState,
  RemoteEventLog,
  RemoteThreadStore,
  RemoteTurnLedger,
  SandboxClient,
  SessionsClient,
} from '@dltech/atlas-harness'

import type { CloudBridge, CloudSandboxes } from './cloud-bridge'
import { reattachSandbox } from './reattach-sandbox'

/**
 * The socket cannot tell resting from broken on its own — a parked sandbox stops answering pings
 * the same way a dead one would — so the channel asks the control plane rather than waiting out
 * its own retry budget. A failed status read is not evidence of parking either, so it stays put
 * rather than escalating on a guess.
 */
export const parkedEscalationOf = (args: {
  sandboxes: SandboxClient
  threadId: ThreadId
}): (() => Promise<boolean>) => {
  const { sandboxes, threadId } = args
  return () =>
    sandboxes.findSandbox({ threadId }).then(
      (status) => status?.state === ECloudSandboxState.Parked,
      () => false,
    )
}

export function createCloudBridge(args: {
  url: string
  token: string
  clientVersion: string
  fetchFn?: typeof fetch | undefined
  lastEventSeq?: (() => number) | undefined
}): CloudBridge {
  const fetchFn = args.fetchFn ?? fetch
  const shared = { url: args.url, token: args.token, clientVersion: args.clientVersion, fetchFn }

  const sessions = new SessionsClient(shared)
  const sandboxes = new SandboxClient(shared)

  const bridgeSandboxes: CloudSandboxes = {
    create: ({ threadId, workspace }) =>
      sandboxes.createSandbox({ threadId, ...(workspace === null ? {} : { workspace }) }),
    putContext: ({ threadId, archive }) => sandboxes.putContextArchive({ threadId, archive }),
    find: ({ threadId }) => sandboxes.findSandbox({ threadId }),
    // Goes over the shared transport directly rather than through SandboxClient, which does not
    // yet carry a destroySandbox method — this can move onto it once it does.
    destroy: ({ threadId }) =>
      cloudRequest({
        ...shared,
        method: 'POST',
        path: `/v1/sandboxes/${threadId}/destroy`,
      }).then(() => undefined),
  }

  return {
    stores: {
      log: new RemoteEventLog({ client: sessions }),
      threads: new RemoteThreadStore({ client: sessions }),
      ledger: new RemoteTurnLedger({ client: sessions }),
    },
    sandboxes: bridgeSandboxes,
    attach: ({ threadId, url, token }) =>
      createRemoteDeltaChannel({
        threadId,
        url,
        token,
        ...(args.lastEventSeq === undefined ? {} : { lastEventSeq: args.lastEventSeq }),
        reattach: () => reattachSandbox({ sandboxes: bridgeSandboxes, threadId }),
        shouldEscalate: parkedEscalationOf({ sandboxes, threadId }),
      }),
  }
}
