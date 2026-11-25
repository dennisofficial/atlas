import type { RecordEvent } from '@dltech/atlas-core'

import type { ControlTx } from './port'

export type AppendHook = {
  name: string
  appliesTo(event: RecordEvent): boolean
  handle(args: { tx: ControlTx; sessionId: string; event: RecordEvent }): Promise<void>
}

export const runAppendHooks = async (args: {
  tx: ControlTx
  sessionId: string
  events: readonly RecordEvent[]
  hooks: readonly AppendHook[] | undefined
}): Promise<void> => {
  for (const event of args.events) {
    for (const hook of args.hooks ?? []) {
      if (!hook.appliesTo(event)) continue
      await hook.handle({ tx: args.tx, sessionId: args.sessionId, event })
    }
  }
}
