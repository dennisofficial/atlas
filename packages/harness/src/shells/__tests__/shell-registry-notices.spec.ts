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
    describe('telling the model a background shell finished', async () => {
      it('writes one event naming the shell, how it ended, and what it printed', async () => {
        const { registry, log } = openRegistry({ adapter })
        const started = await registry.start({
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
          shellId: started.snapshot.shellId,
          command: 'echo hi',
          description: 'Say hi',
          status: ECoreShellStatus.Exited,
          exitCode: 0,
          output: 'hi\n',
          droppedCharacters: 0,
          remainingCharacters: 0,
          outputPath: started.snapshot.outputPath,
          bootId: started.snapshot.bootId,
          outputStart: 0,
          outputEnd: 3,
        })
      })

      it('delivers the ending excerpt without consuming the first explicit read', async () => {
        const { registry, log } = openRegistry({ adapter })
        const started = await registry.start(job({ command: 'echo already-delivered' }))
        if (!started.ok) throw new Error(started.reason)
        await settle({ registry, shellId: started.snapshot.shellId })
        await recorded({ log })

        const delivered = endedDraft(
          log?.appended.find((draft) => draft.type === 'background-shell-ended'),
        )
        const read = await registry.read({ shellId: started.snapshot.shellId, threadId: THREAD })

        expect(delivered.output).toBe('already-delivered\n')
        expect(read.ok && read.delta.text).toBe('already-delivered\n')
        const second = await registry.read({ shellId: started.snapshot.shellId, threadId: THREAD })
        expect(second.ok && second.delta.text).toBe('')
        if (delivered.outputPath === undefined) throw new Error('the ending must name its spool')
        expect(await Bun.file(delivered.outputPath).text()).toBe('already-delivered\n')
      })

      it('writes once, so the same ending is never announced twice', async () => {
        const { registry, log } = openRegistry({ adapter })
        const started = await registry.start(job({ command: 'echo hi' }))
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
        await registry.start(job({ command: 'sleep 30' }))

        await Bun.sleep(100)

        expect(
          log?.appended.filter((draft) => draft.type === 'background-shell-ended'),
        ).toEqual([])
      })
    })

    describe('announcing every ending, whoever caused it', async () => {
      it('announces a failure, naming the code', async () => {
        const { registry, log } = openRegistry({ adapter })
        const started = await registry.start(job({ command: 'exit 7' }))
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
        const started = await registry.start(job({ command: 'sleep 60' }))
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
        const started = await registry.start(job({ command: 'sleep 60' }))
        if (!started.ok) throw new Error(started.reason)

        await registry.closeAll()

        const ended = log?.appended.filter((draft) => draft.type === 'background-shell-ended')
        expect(ended).toHaveLength(1)
        expect(endedDraft(ended?.[0]).shellId).toBe(started.snapshot.shellId)
      })

      it('still announces each ending exactly once', async () => {
        const { registry, log } = openRegistry({ adapter })
        const started = await registry.start(job({ command: 'echo hi' }))
        if (!started.ok) throw new Error(started.reason)
        await settle({ registry, shellId: started.snapshot.shellId })
        await recorded({ log })

        await registry.closeAll()

        expect(
          log?.appended.filter((draft) => draft.type === 'background-shell-ended'),
        ).toHaveLength(1)
      })
    })

    describe('a kill the model asked for', async () => {
      it('hands the ending to the kill call and records it in the log beside it', async () => {
        const { registry, log } = openRegistry({ adapter })
        const started = await registry.start(job({ command: 'echo before; sleep 60' }))
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
        await announced({ registry })
        const ended = log?.appended.filter((draft) => draft.type === 'background-shell-ended')
        expect(ended).toHaveLength(1)
        expect(endedDraft(ended?.[0])).toMatchObject({
          killedBy: EKilledBy.Model,
          output: 'before\n',
        })
        expect(registry.pendingNotices({ threadId: THREAD })).toHaveLength(1)
      })

      it('answers a second kill of the same shell with the same ending', async () => {
        const { registry, log } = openRegistry({ adapter })
        const started = await registry.start(job({ command: 'sleep 60' }))
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
        const started = await registry.start(job({ command: 'sleep 60' }))
        if (!started.ok) throw new Error(started.reason)

        registry.kill({ shellId: started.snapshot.shellId, by: EKilledBy.User, threadId: THREAD })
        const again = registry.kill({
          shellId: started.snapshot.shellId,
          by: EKilledBy.Model,
          threadId: THREAD,
        })
        if (!again.ok) throw new Error('the second kill failed')

        if (again.settled !== undefined) await again.settled
        await recorded({ log })
        const ended = log?.appended.filter((draft) => draft.type === 'background-shell-ended')
        expect(ended).toHaveLength(1)
        expect(endedDraft(ended?.[0]).killedBy).toBe(EKilledBy.User)
      })
    })
  })
}
