import {
  createRemoteDeltaChannel,
  RemoteEventLog,
  RemoteThreadStore,
  RemoteTurnLedger,
  SandboxClient,
  SessionsClient,
} from '@dltech/atlas-harness'

import type { CloudBridge, CloudSandboxes } from './cloud-bridge'
import { reattachSandbox } from './reattach-sandbox'

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
    create: ({ threadId, workspace, skillsBundle }) =>
      sandboxes.createSandbox({
        threadId,
        ...(workspace === null ? {} : { workspace }),
        ...(skillsBundle === undefined ? {} : { skillsBundle }),
      }),
    find: ({ threadId }) => sandboxes.findSandbox({ threadId }),
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
      }),
  }
}
