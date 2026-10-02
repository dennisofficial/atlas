import { describe, expect, it } from 'bun:test'

import { runRelocation, type RelocationPlan } from '../dag'

const deferred = () => {
  let release = (): void => undefined
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

describe('runRelocation with a node failing beside in-flight work', () => {
  it('does not report the failure until the independent in-flight node has finished', async () => {
    const gate = deferred()
    const events: string[] = []
    const plan: RelocationPlan<undefined> = [
      {
        id: 'capture',
        needs: [],
        run: async () => {
          events.push('capture-started')
          await gate.promise
          events.push('capture-finished')
        },
      },
      {
        id: 'fails',
        needs: [],
        run: async () => {
          events.push('fails-started')
          throw new Error('the pause would not land')
        },
      },
    ]

    let settled = false
    const running = runRelocation({ plan, ctx: undefined }).then((result) => {
      settled = true
      return result
    })
    await Bun.sleep(10)

    expect(events).toEqual(['capture-started', 'fails-started'])
    expect(settled).toBe(false)

    gate.release()
    const result = await running

    expect(events).toEqual(['capture-started', 'fails-started', 'capture-finished'])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failed).toBe('fails')
    expect(result.phase).toBe('pre-commit')
    expect(result.error).toEqual(new Error('the pause would not land'))
  })

  it('starts no dependent of either node once the failure is seen', async () => {
    const gate = deferred()
    const started: string[] = []
    const plan: RelocationPlan<undefined> = [
      {
        id: 'capture',
        needs: [],
        run: async () => {
          await gate.promise
        },
      },
      {
        id: 'fails',
        needs: [],
        run: async () => {
          throw new Error('boom')
        },
      },
      {
        id: 'afterCapture',
        needs: ['capture'],
        run: async () => {
          started.push('afterCapture')
        },
      },
      {
        id: 'afterFails',
        needs: ['fails'],
        run: async () => {
          started.push('afterFails')
        },
      },
    ]

    const running = runRelocation({ plan, ctx: undefined })
    await Bun.sleep(10)
    gate.release()
    const result = await running

    expect(result.ok).toBe(false)
    expect(started).toEqual([])
  })

  it('keeps the first failure when the in-flight node fails after it', async () => {
    const gate = deferred()
    const plan: RelocationPlan<undefined> = [
      {
        id: 'capture',
        needs: [],
        run: async () => {
          await gate.promise
          throw new Error('capture failed late')
        },
      },
      {
        id: 'fails',
        needs: [],
        run: async () => {
          throw new Error('failed first')
        },
      },
    ]

    const running = runRelocation({ plan, ctx: undefined })
    await Bun.sleep(10)
    gate.release()
    const result = await running

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failed).toBe('fails')
    expect(result.error).toEqual(new Error('failed first'))
  })
})

describe('runRelocation with an external durable commit marker', () => {
  const commitPlan = (): RelocationPlan<undefined> => [
    { id: 'prepare', needs: [], run: async () => undefined },
    {
      id: 'commit',
      needs: ['prepare'],
      commit: true,
      run: async () => {
        throw new Error('the metadata mirror failed after the placement write')
      },
    },
  ]

  it('reports a throwing commit node as committed when the marker says the write landed', async () => {
    const result = await runRelocation({ plan: commitPlan(), ctx: undefined, isCommitted: () => true })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.phase).toBe('committed')
    expect(result.failed).toBe('commit')
  })

  it('still reports pre-commit when the marker says nothing landed', async () => {
    const result = await runRelocation({ plan: commitPlan(), ctx: undefined, isCommitted: () => false })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.phase).toBe('pre-commit')
  })

  it('reports pre-commit without a marker, as before', async () => {
    const result = await runRelocation({ plan: commitPlan(), ctx: undefined })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.phase).toBe('pre-commit')
  })
})
