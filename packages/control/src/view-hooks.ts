import type { SessionViewState } from '@dltech/atlas-core'

import type { ControlTx } from './port'

export type ViewChangeHook = {
  name: string
  handle(args: {
    tx: ControlTx
    sessionId: string
    before: SessionViewState
    after: SessionViewState
    now: string
  }): Promise<void>
}

export const runViewHooks = async (args: {
  tx: ControlTx
  sessionId: string
  before: SessionViewState
  after: SessionViewState
  hooks: readonly ViewChangeHook[] | undefined
  nowIn: () => Promise<string>
}): Promise<void> => {
  const hooks = args.hooks ?? []
  if (hooks.length === 0) return
  const now = await args.nowIn()
  for (const hook of hooks) {
    await hook.handle({
      tx: args.tx,
      sessionId: args.sessionId,
      before: args.before,
      after: args.after,
      now,
    })
  }
}
