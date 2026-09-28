import type { ThreadId } from '@dltech/atlas-core'
import {
  createRemoteDeltaChannel,
  DRIVE_HOME_PATH,
  ECloudSandboxState,
  RemoteEventLog,
  RemoteThreadStore,
  RemoteTurnLedger,
  sandboxNameFor,
  VercelDriver,
  type LiftedWorkspace,
  type VercelSandboxConfig,
} from '@dltech/atlas-harness'

import type { CloudBridge, CloudSandbox, CloudSandboxes, CloudSandboxStatus } from '@dltech/atlas-harness'
import { reattachSandbox } from './reattach-sandbox'

const BOOTSTRAP_DIRECTORY = `${DRIVE_HOME_PATH}/bootstrap`
const WORKSPACE_SPEC_PATH = `${BOOTSTRAP_DIRECTORY}/workspace-spec.json`
const CONTEXT_ARCHIVE_PATH = `${BOOTSTRAP_DIRECTORY}/context.tar.gz`
const TRANSCRIPT_ARCHIVE_PATH = `${BOOTSTRAP_DIRECTORY}/transcript.tar.gz`

/**
 * The spec serve reads at boot off the drive. The laptop synthesizes it from the captured
 * workspace plus the credentials it already holds — the git token and GPG key the old control
 * plane used to broker onto the row now ride the same drive the workspace lives on.
 */
const bootstrapSpecOf = (args: {
  workspace: LiftedWorkspace | null
  gitToken: string
  gpgKey?: string | undefined
}): string =>
  JSON.stringify({
    remoteUrl: args.workspace?.remoteUrl ?? null,
    branch: args.workspace?.branch ?? null,
    commit: args.workspace?.commit ?? null,
    patch: args.workspace?.patch ?? '',
    githubToken: args.gitToken,
    ...(args.workspace?.gitIdentity === undefined || args.workspace?.gitIdentity === null
      ? {}
      : { gitIdentity: args.workspace.gitIdentity }),
    ...(args.gpgKey === undefined ? {} : { gpgKey: args.gpgKey }),
    ...(args.workspace?.projectDirectory === undefined ||
    args.workspace?.projectDirectory === null
      ? {}
      : { projectDirectory: args.workspace.projectDirectory }),
  })

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
  /** Receives the driver's provision-timing lines; unset in the TUI, set by the live round-trip spec. */
  onDriverLog?: ((line: string) => void) | undefined
}): CloudBridge {
  const driverWith = (config: VercelSandboxConfig): VercelDriver =>
    new VercelDriver({
      credentials: config.credentials,
      cloudUrl: args.url,
      image: config.image,
      serveSources: config.serveSources,
      ...(args.onDriverLog === undefined ? {} : { log: args.onDriverLog }),
    })

  /**
   * Fully client-side: the laptop drives Vercel with the operator's own token, mints the serve
   * token itself, and writes the bootstrap the sandbox needs onto its drive — the workspace spec,
   * the context archive, and later the transcript. No control-plane claim, archive upload, or
   * stamp HEAD; the API's only remaining jobs are the small ones (auth, the registry, the reaper).
   * A name Vercel has never seen boots fresh (needing the bootstrap written before serve reads it);
   * one it has resumes a snapshot that already carries it.
   */
  const create = async (
    createArgs: Parameters<CloudSandboxes['create']>[0],
  ): Promise<CloudSandbox> => {
    const config = args.vercel()
    const driver = driverWith(config)
    const gitToken = await args.readGitToken()
    const name = sandboxNameFor({ threadId: createArgs.threadId })

    const observed = await driver.inspect({ name })
    const freshBoot = observed === undefined
    const bootstrap = bootstrapSpecOf({
      workspace: createArgs.workspace,
      gitToken,
      ...(createArgs.gpgKey === undefined ? {} : { gpgKey: createArgs.gpgKey }),
    })

    const placement = await driver.createOrResume({
      name,
      threadId: createArgs.threadId,
      ...(args.environment === undefined ? {} : { environment: args.environment() }),
      ...(createArgs.captureContext === undefined
        ? {}
        : {
            putContextOnFreshBoot: async () => {
              await createArgs.captureContext!((archive) =>
                driver.writeBootstrapFile({
                  name,
                  path: CONTEXT_ARCHIVE_PATH,
                  content: archive,
                }),
              )
            },
          }),
    })

    // Serve reads the spec at boot off the drive; a resume already has it, so only a fresh boot
    // (or one whose spec moved) needs the write. The transcript rides up separately in the lift.
    if (freshBoot) {
      await driver.writeBootstrapFile({ name, path: WORKSPACE_SPEC_PATH, content: bootstrap })
    }

    return {
      url: placement.url,
      token: placement.token,
      state: placement.state,
      created: placement.created,
      driveName: placement.driveName,
    }
  }

  /**
   * A sandbox Vercel has never heard of reads as parked rather than as nothing: the wake path
   * recreates it, which is the self-healing the old status route got by answering from the row
   * alone. Vercel is the source of truth now — there is no row.
   */
  const find = async (findArgs: { threadId: ThreadId }): Promise<CloudSandboxStatus> => {
    const observed = await driverWith(args.vercel()).inspect({
      name: sandboxNameFor({ threadId: findArgs.threadId }),
    })
    return observed ?? { state: ECloudSandboxState.Parked }
  }

  /**
   * Tears down the sandbox and its drive through the operator's own token. Credentials that
   * vanished from settings since the lift mean there is nothing the operator can reach to destroy,
   * so a missing config is a no-op rather than a stranded-resources error.
   */
  const destroy = async (destroyArgs: { threadId: ThreadId }): Promise<void> => {
    const name = sandboxNameFor({ threadId: destroyArgs.threadId })
    let config: VercelSandboxConfig
    try {
      config = args.vercel()
    } catch {
      return
    }
    await driverWith(config).destroy({ name, threadId: destroyArgs.threadId })
  }

  const bridgeSandboxes: CloudSandboxes = {
    create,
    putContext: ({ threadId, archive }) =>
      driverWith(args.vercel()).writeBootstrapFile({
        name: sandboxNameFor({ threadId }),
        path: CONTEXT_ARCHIVE_PATH,
        content: archive,
      }),
    putTranscript: ({ threadId, archive }) =>
      driverWith(args.vercel()).writeBootstrapFile({
        name: sandboxNameFor({ threadId }),
        path: TRANSCRIPT_ARCHIVE_PATH,
        content: archive,
      }),
    confirmLanded: async ({ threadId }) => ({
      landed: await driverWith(args.vercel()).transcriptLanded({
        name: sandboxNameFor({ threadId }),
      }),
    }),
    find,
    destroy,
  }

  return {
    sandboxes: bridgeSandboxes,
    attach: ({ threadId, url, token }) => {
      const channel = createRemoteDeltaChannel({
        threadId,
        url,
        token,
        ...(args.lastEventSeq === undefined ? {} : { lastEventSeq: args.lastEventSeq }),
        reattach: () => reattachSandbox({ sandboxes: bridgeSandboxes, threadId }),
        shouldEscalate: parkedEscalationOf({ sandboxes: bridgeSandboxes, threadId }),
      })
      return {
        channel,
        stores: {
          log: new RemoteEventLog({ channel }),
          threads: new RemoteThreadStore({ channel }),
          ledger: new RemoteTurnLedger({ channel }),
        },
      }
    },
  }
}
