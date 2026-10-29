import { readRuntimeCheckpointReplySchema, type RuntimeCheckpoint } from '@dltech/atlas-wire'

import { cloudCall, createHarnessApiClient } from './api-trpc-client'
import { CloudError } from './cloud-transport'

const CONFLICT = 409

export const LOCAL_POD_CHECKPOINT_READ_DEADLINE_MS = 1_500

type OwnerSessionCall = {
  url: string
  sessionToken: string
  clientVersion: string
  threadId: string
  fetchFn?: typeof fetch | undefined
}

const ownerApi = (args: OwnerSessionCall) =>
  createHarnessApiClient({
    url: args.url,
    token: args.sessionToken,
    clientVersion: args.clientVersion,
    fetchFn: args.fetchFn ?? fetch,
  })

export const registerLocalPodThread = async (
  args: OwnerSessionCall & {
    projectId: string | null
    model?: string | undefined
    effort?: string | undefined
  },
): Promise<void> => {
  try {
    await cloudCall(
      ownerApi(args).threads.create.mutate({
        id: args.threadId,
        ...(args.projectId === null ? {} : { projectId: args.projectId }),
        ...(args.model === undefined ? {} : { model: args.model }),
        ...(args.effort === undefined ? {} : { effort: args.effort }),
      }),
    )
  } catch (failure) {
    if (failure instanceof CloudError && failure.status === CONFLICT) return
    throw failure
  }
}

export const readLocalPodCheckpoint = async (
  args: OwnerSessionCall,
): Promise<RuntimeCheckpoint | null> => {
  const body = await cloudCall(
    ownerApi(args).localPodCheckpoint.get.query(
      { threadId: args.threadId },
      { signal: AbortSignal.timeout(LOCAL_POD_CHECKPOINT_READ_DEADLINE_MS) },
    ),
    { allowMissing: true },
  )
  if (body === undefined || body === null) return null
  const parsed = readRuntimeCheckpointReplySchema.safeParse(body)
  return parsed.success ? parsed.data.checkpoint : null
}
