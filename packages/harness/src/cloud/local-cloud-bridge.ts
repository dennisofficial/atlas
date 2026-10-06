import type { ThreadId } from '@dltech/atlas-core'
import { EServeEnv, PORTABLE_STATE_PATH, type PortableState } from '@dltech/atlas-wire'

import { sandboxNameFor } from './sandbox-names'
import { ECloudSandboxState } from './sandbox-client'
import type {
  CloudBridge,
  CloudSandbox,
  CloudSandboxes,
  CloudSandboxStatus,
} from './relocation/cloud-bridge'
import type { VercelSandboxConfig } from './vercel-driver'
import { SANDBOX_SERVE_PORT } from './vercel-driver-sdk'
import {
  bootstrapSpecOf,
  CONTEXT_ARCHIVE_PATH,
  liveDriverWith,
  portableOmissionsOf,
  TRANSCRIPT_ARCHIVE_PATH,
  WORKSPACE_ARCHIVE_PATH,
  WORKSPACE_SPEC_PATH,
  type BridgeDriver,
  type LiveSandbox,
  type PortableOmissions,
  vaultPresentInSandbox,
} from './local-cloud-bootstrap'
import { attachmentOf } from './local-cloud-attachment'
import type { LocalCloudBridgeOptions } from './local-cloud-bridge-options'
import { reattachSandbox } from './local-cloud-reattach'
import { registerInBackground } from './local-cloud-registration'
import { transferBufferedArchive } from './buffered-transfer'

export type { LocalCloudBridgeOptions, SandboxAuthorizer } from './local-cloud-bridge-options'

export { reattachSandbox }

export function createLocalCloudBridge(args: LocalCloudBridgeOptions): CloudBridge {
  const driverWith =
    args.driverWith ??
    ((config: VercelSandboxConfig): BridgeDriver =>
      liveDriverWith({
        config,
        ...(args.onDriverLog === undefined ? {} : { onDriverLog: args.onDriverLog }),
        cloudUrl: args.cloudUrl?.() ?? '',
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

    let authorized = false
    const authorize = async (serveUrl: () => string): Promise<void> => {
      if (args.authorizeSandbox === undefined) return
      await args.authorizeSandbox({
        threadId: createArgs.threadId,
        token,
        serveUrl: serveUrl(),
        ...(createArgs.model === undefined ? {} : { model: createArgs.model }),
      })
      authorized = true
    }

    let bootstrap: string | undefined
    const writeBootstrap = async (sandbox: LiveSandbox): Promise<void> => {
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
        const archive = createArgs.transcript
        await transferBufferedArchive({
          archive,
          upload: () => driver.writeBootstrapFileToSandbox({ sandbox, path: TRANSCRIPT_ARCHIVE_PATH, content: archive }),
          onProgress: (progress) => createArgs.onTransferProgress?.({ ...progress, transferId: 'transcript-upload', label: 'uploading conversation' }),
        })
      }
      if (createArgs.workspaceArchivePath !== undefined) {
        await driver.uploadWorkspaceArchive({
          sandbox,
          source: createArgs.workspaceArchivePath,
          destination: WORKSPACE_ARCHIVE_PATH,
          onProgress: (progress) => createArgs.onTransferProgress?.({ ...progress, transferId: 'workspace-upload', label: 'uploading workspace' }),
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
      await authorize(() => sandbox.domain(SANDBOX_SERVE_PORT))
      if (createArgs.captureContext === undefined) return
      await createArgs.captureContext((archive) =>
        transferBufferedArchive({
          archive,
          upload: () => driver.writeBootstrapFileToSandbox({ sandbox, path: CONTEXT_ARCHIVE_PATH, content: archive }),
          onProgress: (progress) => createArgs.onTransferProgress?.({ ...progress, transferId: 'context-upload', label: 'uploading skills and memory' }),
        }),
      )
    }

    const environment: Record<string, string> = {
      ...args.environment?.(),
      ...(createArgs.workspaceDirectory === undefined
        ? {}
        : { [EServeEnv.WorkspaceDir]: createArgs.workspaceDirectory }),
    }

    const placement = await driver.createOrResume({
      name,
      threadId: createArgs.threadId,
      token,
      ...(Object.keys(environment).length === 0 ? {} : { environment }),
      putContextOnFreshBoot: writeBootstrap,
      ...(createArgs.onRotationStarted === undefined
        ? {}
        : { onRotationStarted: createArgs.onRotationStarted }),
      ...(createArgs.onSettleWait === undefined ? {} : { onSettleWait: createArgs.onSettleWait }),
    })

    if (!authorized) await authorize(() => placement.url)

    if (stagedPortable) {
      const omissions = portableOmissionsOf(portable)
      if (omissions !== null) notifyOmitted(omissions)
    }

    registerInBackground({
      options: args,
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
      ...(placement.rotatedFrom === undefined ? {} : { rotatedFrom: placement.rotatedFrom }),
      ...(placement.rotatedProtocol === undefined ? {} : { rotatedProtocol: placement.rotatedProtocol }),
    }
  }

  const find = async (findArgs: { threadId: ThreadId }): Promise<CloudSandboxStatus> => {
    const [observed, reported] = await Promise.all([
      driverWith(args.vercel()).inspect({
        name: sandboxNameFor({ threadId: findArgs.threadId }),
      }),
      args.readCheckpoint?.(findArgs).catch(() => null) ?? null,
    ])
    return {
      ...(observed ?? { state: ECloudSandboxState.Stopped }),
      checkpoint: reported?.threadId === findArgs.threadId ? reported : null,
    }
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
    downloadWorkspace: ({ threadId, path, destination, totalBytes, onProgress }) =>
      driverWith(args.vercel()).downloadWorkspaceArchive({
        name: sandboxNameFor({ threadId }),
        path,
        destination,
        totalBytes,
        onProgress,
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
    attach: attachmentOf({ options: args, sandboxes: bridgeSandboxes }),
  }
}
