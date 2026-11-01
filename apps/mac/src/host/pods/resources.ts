import {
  listLocalPodThreads,
  podNameFor,
  ECloudSandboxState,
  type CloudBridge,
} from '@dltech/atlas-harness'
import {
  EPodState,
  podResizeReplySchema,
  type PodResizeReply,
  type PodStatus,
} from '@dltech/atlas-wire'

export interface IPodResources {
  status: (args: { threadId: string }) => Promise<PodStatus | undefined>
  resize: (args: { threadId: string; vcpus: number }) => Promise<PodResizeReply | undefined>
}

export function createPodResources({
  home,
  bridge,
}: {
  home: string
  bridge: () => {
    sandboxes: Pick<CloudBridge['sandboxes'], 'find' | 'readResources' | 'updateResources'>
  }
}): IPodResources {
  const localRoot = async ({ threadId }: { threadId: string }) =>
    (await listLocalPodThreads({ home })).find((thread) => thread.id === threadId)?.id

  return {
    resize: async ({ threadId, vcpus }) => {
      const id = await localRoot({ threadId })
      if (id === undefined) return undefined
      const result = await bridge().sandboxes.updateResources({ threadId: id, vcpus })
      return podResizeReplySchema.parse({ vcpus, appliesAt: result.appliesAt })
    },
    status: async ({ threadId }) => {
      const id = await localRoot({ threadId })
      if (id === undefined) return undefined
      const { sandboxes } = bridge()
      const observed = await sandboxes.find({ threadId: id })
      const allocation = await sandboxes.readResources({ threadId: id })
      const resources =
        allocation.vcpus === undefined && allocation.memoryMb === undefined
          ? undefined
          : { sandboxId: podNameFor({ threadId: id }), region: 'local', ...allocation }
      return {
        state:
          observed?.state === ECloudSandboxState.Running ? EPodState.Running : EPodState.Parked,
        ...(resources === undefined ? {} : { resources }),
        steps: [],
      }
    },
  }
}
