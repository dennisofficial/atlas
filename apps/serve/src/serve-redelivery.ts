import { EAgentStatus, type OrphanedInput, type ThreadId } from '@dltech/atlas-core'

import { sayToChild } from './child-send'
import type { ServeApp } from './serve-app'
import { RedeliveryDeferred } from './serve-fork-resolution'
import type { ServeTurnDriver } from './turn-driver'

export type ThreadRedeliver = (args: { threadId: ThreadId; input: OrphanedInput }) => Promise<void>

export type ThreadRedeliveryPort = {
  canRedeliverNow: (threadId: ThreadId) => boolean
  redeliver: ThreadRedeliver
}

export type RedeliveryHolder = ThreadRedeliveryPort & {
  bind: (target: ThreadRedeliveryPort) => void
}

export function createRedeliveryHolder(): RedeliveryHolder {
  let target: ThreadRedeliveryPort | undefined
  return {
    canRedeliverNow: (threadId) => target?.canRedeliverNow(threadId) ?? false,
    redeliver: async (given) => {
      if (target === undefined) throw new RedeliveryDeferred()
      return target.redeliver(given)
    },
    bind: (bound) => {
      target = bound
    },
  }
}

type RedeliveryApp = Pick<ServeApp, 'agents' | 'runner' | 'log' | 'ids' | 'roster'>

const childIsStepping = (args: { app: RedeliveryApp; threadId: ThreadId }): boolean | undefined => {
  if (args.app.roster === undefined) return undefined
  const child = args.app.roster.snapshot().agents.find((agent) => agent.agentId === args.threadId)
  return child?.status === EAgentStatus.Running && child.steppingSince !== undefined
}

export function redeliverThrough(args: {
  root: ThreadId
  driver: Pick<ServeTurnDriver, 'say' | 'busy'>
  app: RedeliveryApp
}): ThreadRedeliveryPort {
  const canRedeliverNow = (threadId: ThreadId): boolean =>
    threadId === args.root
      ? !args.driver.busy()
      : childIsStepping({ app: args.app, threadId }) === false

  const redeliver: ThreadRedeliver = async ({ threadId, input }) => {
    if (!canRedeliverNow(threadId)) throw new RedeliveryDeferred()
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
  return { canRedeliverNow, redeliver }
}
