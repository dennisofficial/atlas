import type { ThreadId } from '@dltech/atlas-core'

import {
  EResizeApplies,
  type CloudBridge,
  type CloudSandbox,
  type CloudSandboxes,
  type CloudSandboxStatus,
} from './cloud-bridge'
import { attachmentOf } from './local-cloud-attachment'
import { bootstrapSpecOf, WORKSPACE_SPEC_PATH } from './local-cloud-bootstrap'
import { DockerPodDriver, type PodDriverConfig } from './local-pod/driver'
import { podNameFor } from './local-pod/pod-create'
import type { LocalPodBridgeOptions, PodBridgeDriver } from './local-pod-bridge-options'
import { ECloudSandboxState, sandboxStateSchema } from './sandbox-client'
import type { RunnerPodHandle } from './runner-driver'

export type {
  LocalPodBridgeOptions,
  PodBridgeDriver,
  PodLeaseRegistrar,
} from './local-pod-bridge-options'

export function createLocalPodBridge(args: LocalPodBridgeOptions): CloudBridge {
  const driverWith =
    args.driverWith ??
    ((config: PodDriverConfig): PodBridgeDriver =>
      new DockerPodDriver({ ...config, log: args.onDriverLog }))

  const registerThread = async (thread: {
    threadId: ThreadId
    projectId: string | null
    model: string | undefined
    effort: string | undefined
  }): Promise<void> => {
    if (args.registerThread === undefined) return
    await args.registerThread({
      threadId: thread.threadId,
      projectId: thread.projectId,
      ...(thread.model === undefined ? {} : { model: thread.model }),
      ...(thread.effort === undefined ? {} : { effort: thread.effort }),
    })
  }

  const create = async (
    createArgs: Parameters<CloudSandboxes['create']>[0],
  ): Promise<CloudSandbox> => {
    const driver = driverWith(args.pod())
    const token = args.attachmentToken({ threadId: createArgs.threadId })
    const name = podNameFor({ threadId: createArgs.threadId })

    const stage = async (handle: RunnerPodHandle): Promise<void> => {
      await driver.writeBootstrapFile({
        name: handle.name,
        path: WORKSPACE_SPEC_PATH,
        content: bootstrapSpecOf({
          projectId: createArgs.projectId,
          ...(createArgs.model === undefined ? {} : { model: createArgs.model }),
          ...(createArgs.birth === undefined ? {} : { effort: createArgs.birth.effort }),
        }),
      })
    }

    const environment: Record<string, string> = { ...args.environment?.() }

    await args.registerPodLease({ threadId: createArgs.threadId, token })

    await registerThread({
      threadId: createArgs.threadId,
      projectId: createArgs.projectId,
      model: createArgs.model,
      effort: createArgs.birth?.effort,
    })

    const placement = await driver.createOrResume({
      name,
      threadId: createArgs.threadId,
      token,
      ...(Object.keys(environment).length === 0 ? {} : { environment }),
      putContextOnFreshBoot: stage,
      ...(createArgs.onRotationStarted === undefined
        ? {}
        : { onRotationStarted: createArgs.onRotationStarted }),
      ...(createArgs.onSettleWait === undefined ? {} : { onSettleWait: createArgs.onSettleWait }),
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
      driverWith(args.pod()).inspect({ name: podNameFor({ threadId: findArgs.threadId }) }),
      args.readPodCheckpoint?.(findArgs).catch(() => null) ?? null,
    ])
    return {
      ...(observed === undefined
        ? { state: ECloudSandboxState.Stopped }
        : { ...observed, state: sandboxStateSchema.parse(observed.state) }),
      checkpoint: reported?.threadId === findArgs.threadId ? reported : null,
    }
  }

  const sandboxes: CloudSandboxes = {
    create,
    find,
    readResources: ({ threadId }) =>
      driverWith(args.pod()).readResources({ name: podNameFor({ threadId }) }),
    updateResources: async ({ threadId, vcpus }) => {
      await driverWith(args.pod()).updateResources({ name: podNameFor({ threadId }), vcpus })
      return { appliesAt: EResizeApplies.Live }
    },
    destroy: ({ threadId, expectedSandboxSessionId }) =>
      driverWith(args.pod()).destroy({
        name: podNameFor({ threadId }),
        sessionId: expectedSandboxSessionId,
      }),
  }

  return { sandboxes, attach: attachmentOf({ options: args, sandboxes }) }
}
