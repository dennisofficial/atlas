import { afterEach, describe, expect, it } from 'bun:test'

import {
  announced,
  closeRegistries,
  endedDraft,
  job,
  openRegistry,
  recorded,
  settle,
  shellAdapters,
  THREAD,
} from './shell-registry-fixture'

afterEach(closeRegistries)

for (const adapter of shellAdapters) {
  const describeAdapter = adapter.available ? describe : describe.skip

  describeAdapter(`${adapter.name} process adapter`, () => {
    describe('releasing the output of a dead shell', () => {
      it('releases the buffer once the ending is in the log, and the first read still serves what was printed', async () => {
        const { registry, log } = openRegistry({ adapter })
        const started = registry.start(job({ command: 'echo delivered' }))
        if (!started.ok) throw new Error(started.reason)
        await settle({ registry, shellId: started.snapshot.shellId })
        await recorded({ log })

        // The buffer is released at occurrence — the log holds the output — but the model's first
        // read afterwards still hands it over, served from the delta the capture kept.
        expect(
          registry.peek({ shellId: started.snapshot.shellId, characters: 1000, threadId: THREAD }),
        ).toBe('')

        const read = registry.read({ shellId: started.snapshot.shellId, threadId: THREAD })
        expect(read.ok && read.delta.text).toBe('delivered\n')
        expect(read.ok && read.delta.remainingCharacters).toBe(0)

        const second = registry.read({ shellId: started.snapshot.shellId, threadId: THREAD })
        expect(second.ok && second.delta.text).toBe('')
      })

      it('captures the retained output at settle even without a log, and the first read serves it', async () => {
        // No log wired: the bell rings instead of an ending appending, but the capture still
        // happens at settle — the buffer is released and the first read hands the output over.
        const { registry } = openRegistry({ adapter, log: null })
        const started = registry.start(job({ command: 'echo still-waiting' }))
        if (!started.ok) throw new Error(started.reason)
        await settle({ registry, shellId: started.snapshot.shellId })
        await announced({ registry })

        expect(
          registry.peek({ shellId: started.snapshot.shellId, characters: 1000, threadId: THREAD }),
        ).toBe('')

        const read = registry.read({ shellId: started.snapshot.shellId, threadId: THREAD })
        expect(read.ok && read.delta.text).toBe('still-waiting\n')
      })

      it('the first read hands over what an ending capped at the event limit could not carry', async () => {
        const { registry, log } = openRegistry({ adapter })
        const started = registry.start(job({ command: 'yes y | head -c 40000' }))
        if (!started.ok) throw new Error(started.reason)
        await settle({ registry, shellId: started.snapshot.shellId })
        await recorded({ log })

        const delivered = endedDraft(
          log?.appended.find((draft) => draft.type === 'background-shell-ended'),
        )

        // The event is capped, but the capture keeps the whole remainder for the model's first
        // read — the buffer released at occurrence, so peek sees nothing while read sees all of it.
        expect(delivered.remainingCharacters).toBeGreaterThan(0)
        expect(
          registry.peek({ shellId: started.snapshot.shellId, characters: 1000, threadId: THREAD }),
        ).toBe('')

        const read = registry.read({ shellId: started.snapshot.shellId, threadId: THREAD })
        expect(read.ok && read.delta.text).toHaveLength(40_000)
        expect(read.ok && read.delta.remainingCharacters).toBe(0)
      })
    })
  })
}
