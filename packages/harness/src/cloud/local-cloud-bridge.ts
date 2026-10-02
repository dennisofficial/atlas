import type { ThreadId } from '@dltech/atlas-core'
import { PORTABLE_STATE_PATH, type PortableState } from '@dltech/atlas-wire'

import { createRemoteDeltaChannel } from './remote-delta-channel'
import { RemoteEventLog } from './remote-event-log'
import { RemoteThreadStore } from './remote-thread-store'
import { RemoteTurnLedger } from './remote-turn-ledger'
import { sandboxNameFor } from './sandbox-names'
import { ECloudSandboxState } from './sandbox-client'
import type {
  CloudBridge,
  CloudSandbox,
  CloudSandboxes,
  CloudSandboxStatus,
} from './relocation/cloud-bridge'
import type { VercelSandboxConfig } from './vercel-driver'
import {
  bootstrapSpecOf,
  CONTEXT_ARCHIVE_PATH,
  liveDriverWith,
  parkedEscalationOf,
  portableOmissionsOf,
  TRANSCRIPT_ARCHIVE_PATH,
  WORKSPACE_ARCHIVE_PATH,
  WORKSPACE_SPEC_PATH,
  type BridgeDriver,
  type GitTokenReader,
  type LiveSandbox,
  type PortableOmissions,
  type RegistrationSender,
  type SandboxRegistration,
  vaultPresentInSandbox,
} from './local-cloud-bootstrap'

export async function reattachSandbox(args: {
  sandboxes: CloudSandboxes
  threadId: ThreadId
}): Promise<{ url: string; token: string }> {
  const woken = await args.sandboxes.create({ threadId: args.threadId, workspace: null })
  return { url: woken.url, token: woken.token }
}

export function createLocalCloudBridge(args: {
  vercel: () => VercelSandboxConfig
  attachmentToken: (args: { threadId: ThreadId }) => string
  readGitToken?: GitTokenReader | undefined
  /**
   * Runs only when the sandbox needs a snapshot — a fresh boot, or a resume whose vault never
   * materialised after a failed first boot. A healthy resume never captures, so the sandbox's
   * newer vault is never overwritten.
   */
  capturePortable?: (() => Promise<PortableState>) | undefined
  registration?: SandboxRegistration | undefined
  sendRegistration?: RegistrationSender | undefined
  onRegistrationFailed?: ((failure: unknown) => void) | undefined
  onPortableOmitted?: ((omitted: PortableOmissions) => void) | undefined
  environment?: (() => Record<string, string>) | undefined
  onDriverLog?: ((line: string) => void) | undefined
  lastEventSeq?: (() => number) | undefined
  driverWith?: ((config: VercelSandboxConfig) => BridgeDriver) | undefined
}): CloudBridge {
  const driverWith =
    args.driverWith ??
    ((config: VercelSandboxConfig): BridgeDriver =>
      liveDriverWith({
        config,
        ...(args.onDriverLog === undefined ? {} : { onDriverLog: args.onDriverLog }),
      }))

  const readGitTokenQuietly = async (): Promise<string | undefined> => {
    if (args.readGitToken === undefined) return undefined
    try {
      return await args.readGitToken()
    } catch {
      return undefined
    }
  }

  const notifyOmitted = (omissions: PortableOmissions): void => {
    try {
      args.onPortableOmitted?.(omissions)
    } catch {
      // a notice callback must never fail a sandbox that is already up
    }
  }

  const registerInBackground = (registrationArgs: {
    threadId: ThreadId
    token: string
    serveUrl: string
    driveName: string
  }): void => {
    if (args.registration === undefined || args.sendRegistration === undefined) return
    const { registration, sendRegistration, onRegistrationFailed } = args
    const { threadId, token, serveUrl, driveName } = registrationArgs
    void Promise.resolve()
      .then(() => registration({ threadId }))
      .then((read) => {
        if (read === undefined) return undefined
        return sendRegistration({
          registration: {
            threadId,
            token,
            serveUrl,
            driveName,
            ...(read.metadata === undefined ? {} : { metadata: read.metadata }),
          },
        })
      })
      .catch((failure: unknown) => {
        try {
          onRegistrationFailed?.(failure)
        } catch {
          // the notice itself must never become an unhandled rejection
        }
      })
  }

  const create = async (
    createArgs: Parameters<CloudSandboxes['create']>[0],
  ): Promise<CloudSandbox> => {
    const config = args.vercel()
    const driver = driverWith(config)
    const token = args.attachmentToken({ threadId: createArgs.threadId })
    const name = sandboxNameFor({ threadId: createArgs.threadId })

    const observed = await driver.inspect({ name })
    const freshBoot = observed === undefined

    let portable: PortableState | undefined
    let portableCaptured = false
    let stagedPortable = false
    const captureOnce = async (): Promise<PortableState | undefined> => {
      if (args.capturePortable === undefined) return undefined
      if (!portableCaptured) {
        portable = await args.capturePortable()
        portableCaptured = true
      }
      return portable
    }

    let bootstrap: string | undefined
    const writeBootstrap = async (sandbox: LiveSandbox): Promise<void> => {
      // Serve reads the bootstrap at boot, so it must land before the launch the driver runs after
      // this callback. Writes go through the live sandbox: on a fresh boot the name does not
      // resolve until getOrCreate returns, so a by-name write here would fail.
      if (freshBoot) {
        bootstrap ??= bootstrapSpecOf({
          workspace: createArgs.workspace,
          gitToken: await readGitTokenQuietly(),
          ...(createArgs.gpgKey === undefined ? {} : { gpgKey: createArgs.gpgKey }),
          ...(createArgs.model === undefined ? {} : { model: createArgs.model }),
        })
        await driver.writeBootstrapFileToSandbox({
          sandbox,
          path: WORKSPACE_SPEC_PATH,
          content: bootstrap,
        })
      }
      if (createArgs.transcript !== undefined) {
        await driver.writeBootstrapFileToSandbox({
          sandbox,
          path: TRANSCRIPT_ARCHIVE_PATH,
          content: createArgs.transcript,
        })
      }
      if (createArgs.workspaceArchivePath !== undefined) {
        await driver.uploadWorkspaceArchive({
          sandbox,
          source: createArgs.workspaceArchivePath,
          destination: WORKSPACE_ARCHIVE_PATH,
        })
      }
      const needsPortable = freshBoot || !(await vaultPresentInSandbox(sandbox))
      if (needsPortable) {
        const captured = await captureOnce()
        if (captured !== undefined) {
          await driver.writeBootstrapFileToSandbox({
            sandbox,
            path: PORTABLE_STATE_PATH,
            content: JSON.stringify(captured),
          })
          stagedPortable = true
        }
      }
      if (createArgs.captureContext === undefined) return
      await createArgs.captureContext((archive) =>
        driver.writeBootstrapFileToSandbox({
          sandbox,
          path: CONTEXT_ARCHIVE_PATH,
          content: archive,
        }),
      )
    }

    const placement = await driver.createOrResume({
      name,
      threadId: createArgs.threadId,
      token,
      ...(args.environment === undefined ? {} : { environment: args.environment() }),
      putContextOnFreshBoot: writeBootstrap,
    })

    if (stagedPortable) {
      const omissions = portableOmissionsOf(portable)
      if (omissions !== null) notifyOmitted(omissions)
    }

    registerInBackground({
      threadId: createArgs.threadId,
      token,
      serveUrl: placement.url,
      driveName: placement.driveName,
    })

    return {
      url: placement.url,
      token,
      state: placement.state,
      created: placement.created,
      driveName: placement.driveName,
      ...(placement.outdatedServe === undefined ? {} : { outdatedServe: placement.outdatedServe }),
    }
  }

  const find = async (findArgs: { threadId: ThreadId }): Promise<CloudSandboxStatus> => {
    const observed = await driverWith(args.vercel()).inspect({
      name: sandboxNameFor({ threadId: findArgs.threadId }),
    })
    return observed ?? { state: ECloudSandboxState.Parked }
  }

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
    downloadWorkspace: ({ threadId, path, destination }) =>
      driverWith(args.vercel()).downloadWorkspaceArchive({
        name: sandboxNameFor({ threadId }),
        path,
        destination,
      }),
    releaseWorkspace: ({ threadId, path }) =>
      driverWith(args.vercel()).releaseWorkspaceArchive({
        name: sandboxNameFor({ threadId }),
        path,
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
