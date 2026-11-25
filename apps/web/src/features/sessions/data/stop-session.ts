import type { SessionStopInput, SessionStopOutput } from '@dltech/atlas-protocol'

import { messageOf } from '@/features/threads/data/message-of'

export type StopApi = {
  stop(input: SessionStopInput): Promise<SessionStopOutput>
}

export async function stopSession(args: {
  api: StopApi
  sessionId: string
  notify: (message: string) => void
}): Promise<void> {
  try {
    await args.api.stop({ sessionId: args.sessionId })
  } catch (failure) {
    args.notify(messageOf(failure))
  }
}
