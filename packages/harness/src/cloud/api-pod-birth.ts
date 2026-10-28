import type { PodApiClient } from './api-pod-client'
import { cloudCall } from './api-trpc-client'
import { CloudError } from './cloud-transport'

const CONFLICT = 409

export const createBornThread = async (args: {
  api: Pick<PodApiClient, 'threads'>
  threadId: string
  projectId: string | null
  model: string | undefined
  effort: string
}): Promise<void> => {
  const { threadId, projectId, model, effort } = args
  try {
    await cloudCall(
      args.api.threads.create.mutate({
        id: threadId,
        ...(projectId === null ? {} : { projectId }),
        ...(model === undefined ? {} : { model }),
        effort,
      }),
    )
  } catch (failure) {
    if (failure instanceof CloudError && failure.status === CONFLICT) return
    throw failure
  }
}
