import { describe, expect, it } from 'bun:test'

import { EAgentRestart, type EventDraft } from '@dltech/atlas-core'

import { ETurnStatus } from '..'
import { openSteerable } from './steerable-turn'

const wakeRestart = (threadId: string): EventDraft => ({
  type: 'agent-restarted',
  agentId: 'brn_child' as never,
  agentType: 'teammate',
  intent: 'Review PR #617',
  via: EAgentRestart.Wake,
})

describe('a turn woken by bookkeeping the model never sees', () => {
  it('goes idle rather than assembling an exchange that ends on the assistant', async () => {
    const { runner, harness, model, threadId, queue } = await openSteerable({
      script: [{ text: 'wrapped up' }],
    })

    const first = await runner.say({ threadId, text: 'finish the review' })
    expect(first.status).toBe(ETurnStatus.Completed)
    expect(model.doStreamCalls).toHaveLength(1)

    queue.queue(wakeRestart(threadId))
    const woken = await runner.runTurn({ threadId })

    expect(woken.status).toBe(ETurnStatus.Idle)
    expect(model.doStreamCalls).toHaveLength(1)
  })

  it('still answers when a real notice accompanies the bookkeeping', async () => {
    const { runner, harness, model, threadId, queue } = await openSteerable({
      script: [{ text: 'wrapped up' }, { text: 'the report came in' }],
    })

    await runner.say({ threadId, text: 'finish the review' })

    queue.queue(wakeRestart(threadId))
    queue.queue({
      type: 'agent-reported',
      agentId: 'brn_child' as never,
      agentType: 'teammate',
      intent: 'Review PR #617',
      prose: 'merged',
    })
    const woken = await runner.runTurn({ threadId })

    expect(woken.status).toBe(ETurnStatus.Completed)
    expect(model.doStreamCalls).toHaveLength(2)
  })
})
