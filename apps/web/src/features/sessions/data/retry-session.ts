import type { SessionRetryInput, SessionRetryOutput } from '@dltech/atlas-protocol'

import { messageOf } from '@/features/threads/data/use-send'

export type RetryApi = {
  retry(input: SessionRetryInput): Promise<SessionRetryOutput>
}

export async function retrySession(args: {
  api: RetryApi
  sessionId: string
  agentId?: string
  notify: (message: string) => void
}): Promise<void> {
  try {
    await args.api.retry({
      sessionId: args.sessionId,
      ...(args.agentId === undefined ? {} : { agentId: args.agentId }),
    })
  } catch (failure) {
    args.notify(messageOf(failure))
  }
}
