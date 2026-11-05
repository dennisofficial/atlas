import { describe, expect, it } from 'bun:test'

import { flushUntil, makeRig, seedSession } from './holder-rig'

describe('SessionHolder append reply lost (F8)', () => {
  it('a store that commits then throws still completes the turn with no fork', async () => {
    const rig = await makeRig({ script: [{ text: 'recovered' }] })
    await seedSession(rig)

    const originalAppend = rig.plane.append.bind(rig.plane)
    let sabotaged = false
    rig.plane.append = async (args) => {
      const outcome = await originalAppend(args)
      if (
        !sabotaged &&
        outcome.ok &&
        args.events.some((e) => (e as { type: string }).type === 'user-said')
      ) {
        sabotaged = true
        throw new Error('reply lost')
      }
      return outcome
    }

    await rig.holder.start()
    await rig.post('hello')
    await rig.wake()
    const saw = await flushUntil({
      check: async () => {
        rig.clock.advance(100)
        return (await rig.events()).some((event) => event.type === 'assistant-said')
      },
    })
    expect(saw).toBe(true)
    expect(sabotaged).toBe(true)

    const log = await rig.events()
    const seqs = log.map((event) => event.seq)
    expect(new Set(seqs).size).toBe(seqs.length)
    for (let i = 0; i < seqs.length; i += 1) expect(seqs[i]).toBe(i + 1)
  }, 15_000)
})
