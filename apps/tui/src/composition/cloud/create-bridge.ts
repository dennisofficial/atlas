import type { ThreadId } from '@dltech/atlas-core'
import {
  createRemoteDeltaChannel,
  ECloudSandboxState,
  RemoteEventLog,
  RemoteThreadStore,
  RemoteTurnLedger,
  SandboxClient,
  sandboxNameFor,
  serveStampsReader,
  SessionsClient,
  VercelDriver,
  type VercelSandboxConfig,
} from '@dltech/atlas-harness'

import type { CloudBridge, CloudSandbox, CloudSandboxes, CloudSandboxStatus } from '@dltech/atlas-harness'
import { reattachSandbox } from './reattach-sandbox'

/**
 * The socket cannot tell resting from broken on its own — a parked sandbox stops answering pings
 * the same way a dead one would — so the channel asks Vercel rather than waiting out its own retry
 * budget. A failed status read is not evidence of parking either, so it stays put rather than
 * escalating on a guess.
 */
export const parkedEscalationOf = (args: {
  sandboxes: Pick<CloudSandboxes, 'find'>
  threadId: ThreadId
}): (() => Promise<boolean>) => {
  const { sandboxes, threadId } = args
  return () =>
    sandboxes.find({ threadId }).then(
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
  /** Throwing resolver — a lift with no Vercel credentials fails before anything is claimed. */
  vercel: () => VercelSandboxConfig
  /** Fresh on every claim — `gh auth token`, throwing GitCredentialError when it cannot. */
  readGitToken: () => Promise<string>
  /**
   * The operator-side settings a cloud session inherits, resolved at each lift so a changed
   * value rides the next boot. Only entries with a value appear — an unset key stays absent so
   * the sandbox reads its own fallback rather than an empty string.
   */
  environment?: (() => Record<string, string>) | undefined
}): CloudBridge {
  const fetchFn = args.fetchFn ?? fetch
  const shared = { url: args.url, token: args.token, clientVersion: args.clientVersion, fetchFn }

  const sessions = new SessionsClient(shared)
  const sandboxes = new SandboxClient(shared)

  const driverWith = (config: VercelSandboxConfig): VercelDriver =>
    new VercelDriver({
      credentials: config.credentials,
      cloudUrl: args.url,
      image: config.image,
      serveSources: config.serveSources,
    })

  /**
   * Claim first: the sandbox curls its workspace spec and serve binary off the row the claim
   * upserts, authenticated by the token the claim mints. `contextPending` tells the row whether
   * this boot needs the context archive — known before creating because a name Vercel has never
   * seen boots fresh, and one it has resumes a snapshot that already carries it.
   */
  const create = async (
    createArgs: Parameters<CloudSandboxes['create']>[0],
  ): Promise<CloudSandbox> => {
    const config = args.vercel()
    const driver = driverWith(config)
    const gitToken = await args.readGitToken()
    const name = sandboxNameFor({ threadId: createArgs.threadId })

    const observed = await driver.inspect({ name })
    const claim = await sandboxes.claimSandbox({
      threadId: createArgs.threadId,
      gitToken,
      contextPending: observed === undefined,
      ...(createArgs.workspace === null ? {} : { workspace: createArgs.workspace }),
      ...(createArgs.gpgKey === undefined ? {} : { gpgKey: createArgs.gpgKey }),
    })

    const placement = await driver.createOrResume({
      name,
      threadId: createArgs.threadId,
      token: claim.token,
      ...(args.environment === undefined ? {} : { environment: args.environment() }),
      ...(createArgs.captureContext === undefined
        ? {}
        : {
            putContextOnFreshBoot: () =>
              createArgs.captureContext!((archive) =>
                sandboxes.putContextArchive({ threadId: createArgs.threadId, archive }),
              ),
          }),
      readStamps: serveStampsReader({
        cloudUrl: args.url,
        threadId: createArgs.threadId,
        token: claim.token,
        sources: config.serveSources,
        fetchFn,
      }),
    })

    return {
      url: placement.url,
      token: claim.token,
      state: placement.state,
      created: placement.created,
    }
  }

  /**
   * A sandbox Vercel has never heard of reads as parked rather than as nothing: the wake path
   * recreates it from the row, which is the self-healing the old status route got by answering
   * from the row alone.
   */
  const find = async (findArgs: { threadId: ThreadId }): Promise<CloudSandboxStatus> => {
    const observed = await driverWith(args.vercel()).inspect({
      name: sandboxNameFor({ threadId: findArgs.threadId }),
    })
    return observed ?? { state: ECloudSandboxState.Parked }
  }

  /**
   * Both halves, whichever order they finish in: the Vercel sandbox through the operator's token,
   * and the row through the control plane. Credentials that vanished from settings since the lift
   * skip the Vercel half rather than stranding the row.
   */
  const destroy = async (destroyArgs: { threadId: ThreadId }): Promise<void> => {
    const name = sandboxNameFor({ threadId: destroyArgs.threadId })
    let config: VercelSandboxConfig | null = null
    try {
      config = args.vercel()
    } catch {
      config = null
    }

    const settled = await Promise.allSettled([
      ...(config === null ? [] : [driverWith(config).destroy({ name })]),
      sandboxes.destroySandbox({ threadId: destroyArgs.threadId }),
    ])
    for (const outcome of settled) {
      if (outcome.status === 'rejected') throw outcome.reason
    }
  }

  const bridgeSandboxes: CloudSandboxes = {
    create,
    putContext: ({ threadId, archive }) => sandboxes.putContextArchive({ threadId, archive }),
    find,
    destroy,
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
        shouldEscalate: parkedEscalationOf({ sandboxes: bridgeSandboxes, threadId }),
      }),
  }
}
