import { afterEach, describe, expect, it } from 'bun:test'

import { EShellStatus } from '../background-shell'
import { PROMPT_SETTLE_MS } from '../shell-registry'
import {
  awaitingInputDraft,
  awaitingInputOf,
  closeRegistries,
  job,
  openRegistry,
  recordedDraft,
  settle,
  shellAdapters,
  THREAD,
} from './shell-registry-fixture'

afterEach(closeRegistries)

for (const adapter of shellAdapters) {
  const describeAdapter = adapter.available ? describe : describe.skip

  describeAdapter(`${adapter.name} process adapter`, () => {
    describe('noticing a background shell stuck on a prompt', async () => {
      it('reports a running shell whose last line looks like a question as awaiting input', async () => {
        const { registry } = openRegistry({ adapter })
        const started = await registry.start(job({ command: `printf 'Overwrite? (y/n) '; sleep 30` }))
        if (!started.ok) throw new Error(started.reason)

        expect(await awaitingInputOf({ registry, shellId: started.snapshot.shellId })).toBe(true)
      }, 15_000)

      it('reassembles a prompt split across two chunks of the output stream', async () => {
        const { registry } = openRegistry({ adapter })
        const started = await registry.start(
          job({ command: `printf 'Pass'; sleep 1; printf 'word: '; sleep 30` }),
        )
        if (!started.ok) throw new Error(started.reason)

        expect(await awaitingInputOf({ registry, shellId: started.snapshot.shellId })).toBe(true)

        const peeked = await registry.peek({
          shellId: started.snapshot.shellId,
          characters: 100,
          threadId: THREAD,
        })
        expect(peeked).toBe('Password: ')
      }, 15_000)

      it('says nothing of the sort about a shell printing ordinary progress', async () => {
        const { registry } = openRegistry({ adapter })
        const started = await registry.start(job({ command: `echo 'compiled 12 modules'; sleep 30` }))
        if (!started.ok) throw new Error(started.reason)
        await Bun.sleep(300)

        const snapshot = registry
          .list({ threadId: THREAD })
          .find((entry) => entry.shellId === started.snapshot.shellId)

        expect(snapshot?.awaitingInput).toBe(false)
      })

      it('announces a shell that stopped to ask, so the model can answer it', async () => {
        const { registry, log } = openRegistry({ adapter })
        const started = await registry.start(job({ command: `printf 'Password: '; sleep 30` }))
        if (!started.ok) throw new Error(started.reason)
        expect(await awaitingInputOf({ registry, shellId: started.snapshot.shellId })).toBe(true)

        await recordedDraft({ log, type: 'background-shell-awaiting-input' })
        expect(registry.drainNotifications({ threadId: THREAD })).toEqual([])

        expect(
          awaitingInputDraft(
            log?.appended.find((draft) => draft.type === 'background-shell-awaiting-input'),
          ),
        ).toMatchObject({
          type: 'background-shell-awaiting-input',
          shellId: started.snapshot.shellId,
          command: `printf 'Password: '; sleep 30`,
          description: 'Run a background job',
          output: 'Password: ',
          droppedCharacters: 0,
          remainingCharacters: 0,
          outputPath: started.snapshot.outputPath,
          bootId: started.snapshot.bootId,
          inputSupported: started.snapshot.inputSupported,
          outputStart: 0,
          outputEnd: 'Password: '.length,
        })
        const read = await registry.read({ shellId: started.snapshot.shellId, threadId: THREAD })
        expect(read.ok && read.delta.text).toBe('Password: ')
        const second = await registry.read({ shellId: started.snapshot.shellId, threadId: THREAD })
        expect(second.ok && second.delta.text).toBe('')
        if (started.snapshot.outputPath === undefined) throw new Error('the shell must name its spool')
        expect(await Bun.file(started.snapshot.outputPath).text()).toBe('Password: ')
      }, 15_000)

      it('queues nothing for a slow command, so it is left alone however long it runs', async () => {
        const { registry } = openRegistry({ adapter })
        const started = await registry.start(job({ command: `printf 'compiled 12 modules'; sleep 30` }))
        if (!started.ok) throw new Error(started.reason)
        await Bun.sleep(PROMPT_SETTLE_MS + 500)

        const snapshot = registry
          .list({ threadId: THREAD })
          .find((entry) => entry.shellId === started.snapshot.shellId)

        expect(snapshot?.status).toBe(EShellStatus.Running)
        expect(snapshot?.awaitingInput).toBe(false)
        expect(registry.drainNotifications({ threadId: THREAD })).toEqual([])
      }, 15_000)

      it('stops claiming it once the shell has ended', async () => {
        const { registry } = openRegistry({ adapter })
        const started = await registry.start(job({ command: `printf 'Continue? (y/n) '` }))
        if (!started.ok) throw new Error(started.reason)
        await settle({ registry, shellId: started.snapshot.shellId })

        const snapshot = registry
          .list({ threadId: THREAD })
          .find((entry) => entry.shellId === started.snapshot.shellId)

        expect(snapshot?.awaitingInput).toBe(false)
      })
    })
  })
}
