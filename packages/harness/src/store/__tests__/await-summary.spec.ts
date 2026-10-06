import { describe, expect, it } from 'bun:test'

import { awaitSummary } from '../await-summary'

const args = { events: [], fromSeq: 1, throughSeq: 2 }

describe('awaitSummary', () => {
  it('removes its abort listener once the model settles', async () => {
    const controller = new AbortController()
    let added = 0
    let removed = 0
    const add = controller.signal.addEventListener.bind(controller.signal)
    const remove = controller.signal.removeEventListener.bind(controller.signal)
    controller.signal.addEventListener = ((...rest: Parameters<typeof add>) => {
      added += 1
      return add(...rest)
    }) as typeof add
    controller.signal.removeEventListener = ((...rest: Parameters<typeof remove>) => {
      removed += 1
      return remove(...rest)
    }) as typeof remove
    expect(
      await awaitSummary({ summarise: async () => 'done', args, signal: controller.signal }),
    ).toBe('done')
    expect(added).toBe(1)
    expect(removed).toBe(1)
  })

  it('removes its abort listener when the model rejects', async () => {
    const controller = new AbortController()
    let removed = 0
    const remove = controller.signal.removeEventListener.bind(controller.signal)
    controller.signal.removeEventListener = ((...rest: Parameters<typeof remove>) => {
      removed += 1
      return remove(...rest)
    }) as typeof remove
    await expect(
      awaitSummary({
        summarise: async () => {
          throw new Error('provider failed')
        },
        args,
        signal: controller.signal,
      }),
    ).rejects.toThrow('provider failed')
    expect(removed).toBe(1)
  })

  it('rejects a synchronous throw from the model instead of escaping', async () => {
    await expect(
      awaitSummary({
        summarise: () => {
          throw new Error('threw before returning a promise')
        },
        args,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('threw before returning a promise')
  })

  it('passes the signal through and works without one', async () => {
    const controller = new AbortController()
    let seen: AbortSignal | undefined
    await awaitSummary({
      summarise: async (given) => {
        seen = given.signal
        return 'x'
      },
      args,
      signal: controller.signal,
    })
    expect(seen).toBe(controller.signal)
    expect(await awaitSummary({ summarise: async () => 'bare', args })).toBe('bare')
  })
})
