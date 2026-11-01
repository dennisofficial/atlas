import type { OrphanedInput, ThreadId } from '@dltech/atlas-core'

import { sayToChild } from './child-send'
import type { ServeApp } from './serve-app'
import type { ServeTurnDriver } from './turn-driver'

export type ThreadRedeliver = (args: { threadId: ThreadId; input: OrphanedInput }) => Promise<void>

export type RedeliveryHolder = {
  redeliver: ThreadRedeliver
  bind: (target: ThreadRedeliver) => void
}

export function createRedeliveryHolder(): RedeliveryHolder {
  let bind: (target: ThreadRedeliver) => void = () => undefined
  const bound = new Promise<ThreadRedeliver>((resolve) => {
    bind = resolve
  })
  return {
    redeliver: async (given) => (await bound)(given),
    bind: (target) => bind(target),
  }
}

export function redeliverThrough(args: {
  root: ThreadId
  driver: Pick<ServeTurnDriver, 'say'>
  app: Pick<ServeApp, 'agents' | 'runner' | 'log' | 'ids'>
}): ThreadRedeliver {
  return async ({ threadId, input }) => {
    if (threadId === args.root) return args.driver.say(input)
    const { agents, runner, log, ids } = args.app
    if (agents === undefined)
      throw new Error('this session cannot deliver a message to a child thread')
    await sayToChild({
      agents,
      runner,
      log,
      ids,
      owner: args.root,
      agentId: threadId,
      frame: input,
    })
  }
}
