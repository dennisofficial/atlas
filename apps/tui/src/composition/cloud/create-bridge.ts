import {
  createRemoteDeltaChannel,
  RemoteEventLog,
  RemoteThreadStore,
  RemoteTurnLedger,
  SandboxClient,
  SessionsClient,
} from '@dltech/atlas-harness'

import type { CloudBridge } from './cloud-bridge'

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

  return {
    stores: {
      log: new RemoteEventLog({ client: sessions }),
      threads: new RemoteThreadStore({ client: sessions }),
      ledger: new RemoteTurnLedger({ client: sessions }),
    },
    sandboxes: {
      create: ({ threadId, workspace }) =>
        sandboxes.createSandbox({
          threadId,
          ...(workspace === null ? {} : { workspace }),
        }),
      find: ({ threadId }) => sandboxes.findSandbox({ threadId }),
    },
    attach: ({ threadId, url, token }) =>
      createRemoteDeltaChannel({
        threadId,
        url,
        token,
        ...(args.lastEventSeq === undefined ? {} : { lastEventSeq: args.lastEventSeq }),
      }),
  }
}
