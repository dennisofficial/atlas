import type { ThreadId } from '@dltech/atlas-core'
import { PORTABLE_STATE_PATH } from '@dltech/atlas-wire'

import { transferBufferedArchive } from './buffered-transfer'
import {
  EResizeApplies,
  type CloudBridge,
  type CloudSandbox,
  type CloudSandboxes,
  type CloudSandboxStatus,
} from './cloud-bridge'
import { attachmentOf } from './local-cloud-attachment'
import { bootstrapSpecOf, CONTEXT_ARCHIVE_PATH, WORKSPACE_SPEC_PATH } from './local-cloud-bootstrap'
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
    ((config: PodDriverConfig): PodBridgeDriver => new DockerPodDriver({ ...config, log: args.onDriverLog }))

  const readGitTokenQuietly = async (): Promise<string | undefined> => {
    if (args.readGitToken === undefined) return undefined
    try {
      return await args.readGitToken()
    } catch {
      return undefined
    }
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
          workspace: createArgs.workspace,
          gitToken: await readGitTokenQuietly(),
          ...(createArgs.model === undefined ? {} : { model: createArgs.model }),
        }),
      })
      if (await driver.vaultPresent({ name: handle.name })) return
      const portable = await args.capturePortable?.()
      if (portable !== undefined) {
        await driver.writeBootstrapFile({
          name: handle.name,
          path: PORTABLE_STATE_PATH,
          content: JSON.stringify(portable),
        })
      }
      await createArgs.captureContext?.((archive) =>
        transferBufferedArchive({
          archive,
          upload: () =>
            driver.writeBootstrapFile({ name: handle.name, path: CONTEXT_ARCHIVE_PATH, content: archive }),
          onProgress: (progress) =>
            createArgs.onTransferProgress?.({
              ...progress,
              transferId: 'context-upload',
              label: 'uploading skills and memory',
            }),
        }),
      )
    }

    const environment: Record<string, string> = { ...args.environment?.() }

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

    await args.registerPodLease({ threadId: createArgs.threadId, token })

    return {
      url: placement.url,
      token,
      state: sandboxStateSchema.parse(placement.state),
      created: placement.created,
      ...(placement.rotatedFrom === undefined ? {} : { rotatedFrom: placement.rotatedFrom }),
      ...(placement.rotatedProtocol === undefined ? {} : { rotatedProtocol: placement.rotatedProtocol }),
    }
  }

  const find = async (findArgs: { threadId: ThreadId }): Promise<CloudSandboxStatus> => {
    const observed = await driverWith(args.pod()).inspect({ name: podNameFor({ threadId: findArgs.threadId }) })
    return {
      ...(observed === undefined
        ? { state: ECloudSandboxState.Stopped }
        : { ...observed, state: sandboxStateSchema.parse(observed.state) }),
      checkpoint: null,
    }
  }

  const sandboxes: CloudSandboxes = {
    create,
    find,
    readResources: ({ threadId }) => driverWith(args.pod()).readResources({ name: podNameFor({ threadId }) }),
    updateResources: async ({ threadId, vcpus }) => {
      await driverWith(args.pod()).updateResources({ name: podNameFor({ threadId }), vcpus })
      return { appliesAt: EResizeApplies.Live }
    },
    destroy: ({ threadId, expectedSandboxSessionId }) =>
      driverWith(args.pod()).destroy({ name: podNameFor({ threadId }), sessionId: expectedSandboxSessionId }),
  }

  return { sandboxes, attach: attachmentOf({ options: args, sandboxes }) }
}
