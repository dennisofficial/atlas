import type { ThreadId } from '@dltech/atlas-core'

export type TurnEndedArgs = { sessionId: string; threadId: ThreadId }

export type TurnEndedHook = (args: TurnEndedArgs) => Promise<void>
