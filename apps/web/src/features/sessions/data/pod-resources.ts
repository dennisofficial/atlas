import type {
  SessionCommandInput,
  SessionCommandOutput,
  SessionPodResourcesOutput,
} from '@dltech/atlas-protocol'

export type PodResourcesApi = {
  podResources: (input: { sessionId: string }) => Promise<SessionPodResourcesOutput>
  command: (input: SessionCommandInput) => Promise<SessionCommandOutput>
}

export const fetchPodResources = (args: {
  api: Pick<PodResourcesApi, 'podResources'>
  sessionId: string
}): Promise<SessionPodResourcesOutput> => args.api.podResources({ sessionId: args.sessionId })

export const resizePod = async (args: {
  api: Pick<PodResourcesApi, 'command'>
  sessionId: string
  vcpus: number
}): Promise<void> => {
  await args.api.command({ sessionId: args.sessionId, name: 'resize', args: { vcpus: args.vcpus } })
}
