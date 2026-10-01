import { afterEach, describe, expect, it } from 'bun:test'

import { EKilledBy, EShellStatus as ECoreShellStatus } from '@dltech/atlas-core'

import {
  announced,
  closeRegistries,
  endedDraft,
  job,
  openRegistry,
  printed,
  recorded,
  settle,
  shellAdapters,
  THREAD,
} from './shell-registry-fixture'

afterEach(closeRegistries)

for (const adapter of shellAdapters) {
  const describeAdapter = adapter.available ? describe : describe.skip

  describeAdapter(`${adapter.name} process adapter`, () => {
    describe('telling the model a background shell finished', () => {
      it('writes one event naming the shell, how it ended, and what it printed', async () => {
        const { registry, log } = openRegistry({ adapter })
        const started = registry.start({
          threadId: THREAD,
          command: 'echo hi',
          description: 'Say hi',
        })
        if (!started.ok) throw new Error(started.reason)

        await settle({ registry, shellId: started.snapshot.shellId })
        await recorded({ log })

        const ended = log?.appended.filter((draft) => draft.type === 'background-shell-ended')
        expect(ended).toHaveLength(1)
        expect(endedDraft(ended?.[0])).toMatchObject({
          type: 'background-shell-ended',
          shellId: 'bash_1',
          command: 'echo hi',
          description: 'Say hi',
          status: ECoreShellStatus.Exited,
          exitCode: 0,
          output: 'hi\n',
          droppedCharacters: 0,
          remainingCharacters: 0,
        })
      })

      it('hands the output over rather than asking the model to go and read it', async () => {
        const { registry, log } = openRegistry({ adapter })
        const started = registry.start(job({ command: 'echo already-delivered' }))
        if (!started.ok) throw new Error(started.reason)
        await settle({ registry, shellId: started.snapshot.shellId })
        await recorded({ log })

        const delivered = endedDraft(
          log?.appended.find((draft) => draft.type === 'background-shell-ended'),
        )
        const read = registry.read({ shellId: started.snapshot.shellId, threadId: THREAD })

        expect(delivered.output).toBe('already-delivered\n')
        // The capture at occurrence keeps the delta for the model's first read: the log holds the
        // ending, and shell_output still hands over what the shell printed rather than nothing.
        expect(read.ok && read.delta.text).toBe('already-delivered\n')
      })

      it('writes once, so the same ending is never announced twice', async () => {
        const { registry, log } = openRegistry({ adapter })
        const started = registry.start(job({ command: 'echo hi' }))
        if (!started.ok) throw new Error(started.reason)
        await settle({ registry, shellId: started.snapshot.shellId })
        await recorded({ log })

        await registry.closeAll()

        expect(
          log?.appended.filter((draft) => draft.type === 'background-shell-ended'),
        ).toHaveLength(1)
      })

      it('writes nothing while the command is still running', async () => {
        const { registry, log } = openRegistry({ adapter })
        registry.start(job({ command: 'sleep 30' }))

        await Bun.sleep(100)

        expect(
          log?.appended.filter((draft) => draft.type === 'background-shell-ended'),
        ).toEqual([])
      })
    })

    describe('announcing every ending, whoever caused it', () => {
      it('announces a failure, naming the code', async () => {
        const { registry, log } = openRegistry({ adapter })
        const started = registry.start(job({ command: 'exit 7' }))
        if (!started.ok) throw new Error(started.reason)
        await settle({ registry, shellId: started.snapshot.shellId })
        await recorded({ log })

        expect(
          endedDraft(log?.appended.find((draft) => draft.type === 'background-shell-ended'))
            .exitCode,
        ).toBe(7)
      })

      it('announces a shell the developer killed, so the model stops reasoning about a dead server', async () => {
        const { registry, log } = openRegistry({ adapter })
        const started = registry.start(job({ command: 'sleep 60' }))
        if (!started.ok) throw new Error(started.reason)

        registry.kill({ shellId: started.snapshot.shellId, by: EKilledBy.User, threadId: THREAD })
        await recorded({ log })

        const ended = log?.appended.filter((draft) => draft.type === 'background-shell-ended')
        expect(ended).toHaveLength(1)
        expect(endedDraft(ended?.[0]).status).toBe(ECoreShellStatus.Killed)
        expect(endedDraft(ended?.[0]).killedBy).toBe(EKilledBy.User)
      })

      it('announces a shell killed by teardown rather than suppressing it', async () => {
        const { registry, log } = openRegistry({ adapter })
        const started = registry.start(job({ command: 'sleep 60' }))
        if (!started.ok) throw new Error(started.reason)

        await registry.closeAll()

        const ended = log?.appended.filter((draft) => draft.type === 'background-shell-ended')
        expect(ended).toHaveLength(1)
        expect(endedDraft(ended?.[0]).shellId).toBe(started.snapshot.shellId)
      })

      it('still announces each ending exactly once', async () => {
        const { registry, log } = openRegistry({ adapter })
        const started = registry.start(job({ command: 'echo hi' }))
        if (!started.ok) throw new Error(started.reason)
        await settle({ registry, shellId: started.snapshot.shellId })
        await recorded({ log })

        await registry.closeAll()

        expect(
          log?.appended.filter((draft) => draft.type === 'background-shell-ended'),
        ).toHaveLength(1)
      })
    })

    describe('a kill the model asked for', () => {
      it('hands the ending to the kill call and records it in the log beside it', async () => {
        const { registry, log } = openRegistry({ adapter })
        const started = registry.start(job({ command: 'echo before; sleep 60' }))
        if (!started.ok) throw new Error(started.reason)
        await printed({ registry, shellId: started.snapshot.shellId, text: 'before' })

        const killed = registry.kill({
          shellId: started.snapshot.shellId,
          by: EKilledBy.Model,
          threadId: THREAD,
        })
        if (!killed.ok || killed.settled === undefined) {
          throw new Error('a model kill hands back the settled continuation')
        }
        const ending = await killed.settled

        expect(ending.died).toBe(true)
        if (ending.died) {
          expect(ending.snapshot.status).toBe(ECoreShellStatus.Killed)
          expect(ending.snapshot.killedBy).toBe(EKilledBy.Model)
          expect(ending.delta.text).toContain('before')
        }

        await recorded({ log })
        const ended = log?.appended.filter((draft) => draft.type === 'background-shell-ended')
        expect(ended).toHaveLength(1)
        expect(endedDraft(ended?.[0])).toMatchObject({
          killedBy: EKilledBy.Model,
          output: 'before\n',
        })
        expect(registry.pendingNotices({ threadId: THREAD })).toEqual([])
      })

      it('answers a second kill of the same shell with the same ending', async () => {
        const { registry, log } = openRegistry({ adapter })
        const started = registry.start(job({ command: 'sleep 60' }))
        if (!started.ok) throw new Error(started.reason)

        const first = registry.kill({
          shellId: started.snapshot.shellId,
          by: EKilledBy.Model,
          threadId: THREAD,
        })
        const second = registry.kill({
          shellId: started.snapshot.shellId,
          by: EKilledBy.Model,
          threadId: THREAD,
        })
        if (!first.ok || !second.ok) throw new Error('a kill failed')
        if (first.settled === undefined || second.settled === undefined) {
          throw new Error('the settled continuations went missing')
        }

        const [one, two] = await Promise.all([first.settled, second.settled])

        expect(one.died).toBe(true)
        expect(two.died).toBe(true)
        await recorded({ log })
        expect(
          log?.appended.filter((draft) => draft.type === 'background-shell-ended'),
        ).toHaveLength(1)
      })

      it('a later model kill of a dying shell reads the same ending the log records', async () => {
        const { registry, log } = openRegistry({ adapter })
        const started = registry.start(job({ command: 'sleep 60' }))
        if (!started.ok) throw new Error(started.reason)

        registry.kill({ shellId: started.snapshot.shellId, by: EKilledBy.User, threadId: THREAD })
        const again = registry.kill({
          shellId: started.snapshot.shellId,
          by: EKilledBy.Model,
          threadId: THREAD,
        })
        if (!again.ok) throw new Error('the second kill failed')

        // The shell was already dying; the model kill joins the same ending rather than starting
        // a second one. The log records it once, naming who actually signalled first.
        if (again.settled !== undefined) await again.settled
        await recorded({ log })
        const ended = log?.appended.filter((draft) => draft.type === 'background-shell-ended')
        expect(ended).toHaveLength(1)
        expect(endedDraft(ended?.[0]).killedBy).toBe(EKilledBy.User)
      })
    })
  })
}
