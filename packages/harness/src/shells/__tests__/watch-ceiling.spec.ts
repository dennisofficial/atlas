import { afterEach, describe, expect, it } from 'bun:test'

import { EKilledBy, EShellStatus } from '@dltech/atlas-core'

import {
  closeRegistries,
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
    describe('giving a background shell a ceiling', async () => {
      it('kills a shell that outlives its timeout and still announces the ending', async () => {
        const { registry, log } = openRegistry({ adapter })
        const started = await registry.start({
          threadId: THREAD,
          command: 'sleep 30',
          description: 'Wait too long',
          timeoutMs: 300,
        })
        if (!started.ok) throw new Error(started.reason)

        await settle({ registry, shellId: started.snapshot.shellId })
        await recorded({ log })

        const ended = log?.appended.find((draft) => draft.type === 'background-shell-ended')
        expect(ended).toMatchObject({
          shellId: started.snapshot.shellId,
          status: EShellStatus.Killed,
          killedBy: EKilledBy.Timeout,
        })
      }, 15_000)

      it('lets a shell that finishes in time end on its own terms', async () => {
        const { registry, log } = openRegistry({ adapter })
        const started = await registry.start({
          threadId: THREAD,
          command: 'echo quick',
          description: 'Finish in time',
          timeoutMs: 10_000,
        })
        if (!started.ok) throw new Error(started.reason)

        await settle({ registry, shellId: started.snapshot.shellId })
        await recorded({ log })

        const ended = log?.appended.find((draft) => draft.type === 'background-shell-ended')
        expect(ended).toMatchObject({
          status: EShellStatus.Exited,
          exitCode: 0,
        })
      })
    })
  })
}
