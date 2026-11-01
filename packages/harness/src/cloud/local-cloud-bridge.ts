import type { ThreadId } from '@dltech/atlas-core'

import { sandboxNameFor } from './sandbox-names'
import { ECloudSandboxState, sandboxStateSchema } from './sandbox-client'
import {
  EResizeApplies,
  type CloudBridge,
  type CloudMessages,
  type CloudSandbox,
  type CloudSandboxes,
  type CloudSandboxStatus,
} from './cloud-bridge'
import { LOCAL_POD_MESSAGES_MESSAGE } from './local-pod-bridge'
import { SANDBOX_SERVE_PORT, type VercelSandboxConfig } from '@dltech/atlas-wire'
import {
  bootstrapSpecOf,
  liveDriverWith,
  WORKSPACE_SPEC_PATH,
  type BridgeDriver,
  type LiveSandbox,
} from './local-cloud-bootstrap'
import { attachmentOf } from './local-cloud-attachment'
import type { LocalCloudBridgeOptions } from './local-cloud-bridge-options'
import { registerInBackground } from './local-cloud-registration'

export type { LocalCloudBridgeOptions, SandboxAuthorizer } from './local-cloud-bridge-options'

export function createLocalCloudBridge(args: LocalCloudBridgeOptions): CloudBridge {
  const driverWith =
    args.driverWith ??
    ((config: VercelSandboxConfig): BridgeDriver =>
      liveDriverWith({
        config,
        ...(args.onDriverLog === undefined ? {} : { onDriverLog: args.onDriverLog }),
        cloudUrl: args.cloudUrl?.() ?? '',
      }))

  const create = async (
    createArgs: Parameters<CloudSandboxes['create']>[0],
  ): Promise<CloudSandbox> => {
    const config = args.vercel()
    const driver = driverWith(config)
    const token = args.attachmentToken({ threadId: createArgs.threadId })
    const name = sandboxNameFor({ threadId: createArgs.threadId })

    const observed = await driver.inspect({ name })
    const freshBoot = observed === undefined

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
          projectId: createArgs.projectId,
          ...(createArgs.model === undefined ? {} : { model: createArgs.model }),
          ...(createArgs.birth === undefined ? {} : { effort: createArgs.birth.effort }),
        })
        await driver.writeBootstrapFileToSandbox({
          sandbox,
          path: WORKSPACE_SPEC_PATH,
          content: bootstrap,
        })
      }
      await authorize(() => sandbox.domain(SANDBOX_SERVE_PORT))
    }

    const environment: Record<string, string> = {
      ...args.environment?.(),
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

    registerInBackground({
      options: args,
      threadId: createArgs.threadId,
      token,
      serveUrl: placement.url,
      serveVersion: placement.serveVersion ?? config.serveVersion,
    })

    return {
      url: placement.url,
      token,
      state: sandboxStateSchema.parse(placement.state),
      created: placement.created,
      ...(placement.rotatedFrom === undefined ? {} : { rotatedFrom: placement.rotatedFrom }),
      ...(placement.rotatedProtocol === undefined
        ? {}
        : { rotatedProtocol: placement.rotatedProtocol }),
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
      ...(observed == null
        ? { state: ECloudSandboxState.Stopped }
        : { ...observed, state: sandboxStateSchema.parse(observed.state) }),
      checkpoint: reported?.threadId === findArgs.threadId ? reported : null,
    }
  }

  const destroy = async (destroyArgs: Parameters<CloudSandboxes['destroy']>[0]): Promise<void> => {
    const name = sandboxNameFor({ threadId: destroyArgs.threadId })
    const expectedSandboxSessionId = destroyArgs.expectedSandboxSessionId
    let config: VercelSandboxConfig
    try {
      config = args.vercel()
    } catch (failure) {
      if (expectedSandboxSessionId !== undefined) throw failure
      return
    }
    await driverWith(config).destroy({
      name,
      sessionId: expectedSandboxSessionId,
    })
  }

  const bridgeSandboxes: CloudSandboxes = {
    create,
    readResources: ({ threadId }) =>
      driverWith(args.vercel()).readResources({ name: sandboxNameFor({ threadId }) }),
    updateResources: async ({ threadId, vcpus }) => {
      await driverWith(args.vercel()).updateResources({ name: sandboxNameFor({ threadId }), vcpus })
      return { appliesAt: EResizeApplies.Restart }
    },
    find,
    destroy,
  }

  const messages: CloudMessages = {
    send: () => Promise.reject(new Error(LOCAL_POD_MESSAGES_MESSAGE)),
  }

  return {
    sandboxes: bridgeSandboxes,
    messages,
    attach: attachmentOf({ options: args, sandboxes: bridgeSandboxes }),
  }
}
