import { describe, expect, it } from 'bun:test'

import { changeThreadModel } from '../change-thread-model'

const model = { ref: 'anthropic/claude-opus-5', effort: 'high' }

describe('changeThreadModel', () => {
  it('sets it live only and never patches while the channel is connected', async () => {
    const calls: string[] = []
    await changeThreadModel({
      threadId: 't1',
      model,
      chooseLive: async () => {
        calls.push('live')
        return true
      },
      patch: async () => void calls.push('patch'),
    })
    expect(calls).toEqual(['live'])
  })

  it('patches only when the channel is not connected', async () => {
    const calls: string[] = []
    await changeThreadModel({
      threadId: 't1',
      model,
      chooseLive: async () => false,
      patch: async (args) => void calls.push(`${args.threadId}:${args.model.ref}`),
    })
    expect(calls).toEqual(['t1:anthropic/claude-opus-5'])
  })

  it('does not patch and rejects when the live change fails', async () => {
    const calls: string[] = []
    const failure = changeThreadModel({
      threadId: 't1',
      model,
      chooseLive: async () => {
        throw new Error('refused')
      },
      patch: async () => void calls.push('patch'),
    })
    await expect(failure).rejects.toThrow('refused')
    expect(calls).toEqual([])
  })
})
