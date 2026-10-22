import { afterEach, describe, expect, it } from 'bun:test'
import { basename } from 'node:path'

import { EShellStatus } from '../background-shell'
import { toShellId } from '../shell-id'
import {
  closeRegistries,
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
    describe('starting a shell in the background', async () => {
      it('returns a shell id at once rather than waiting for the command', async () => {
        const { registry } = openRegistry({ adapter })

        const started = await registry.start(job({ command: 'sleep 30' }))

        expect(started.ok).toBe(true)
        if (!started.ok) return
        expect(started.snapshot.shellId).toBe(toShellId('shell_1'))
        expect(started.snapshot.status).toBe(EShellStatus.Running)
      })

      it('assigns distinct ids so two shells are told apart', async () => {
        const { registry } = openRegistry({ adapter })

        const first = await registry.start(job({ command: 'sleep 30' }))
        const second = await registry.start(job({ command: 'sleep 30' }))

        if (!first.ok) throw new Error(first.reason)
        if (!second.ok) throw new Error(second.reason)
        expect(first.snapshot.shellId).not.toBe(second.snapshot.shellId)
        expect(registry.list({ threadId: THREAD }).map((shell) => shell.shellId)).toEqual([
          first.snapshot.shellId,
          second.snapshot.shellId,
        ])
      })

      it('runs the command in the workspace root', async () => {
        const { registry, root, log } = openRegistry({ adapter })

        const started = await registry.start(job({ command: 'pwd' }))
        if (!started.ok) throw new Error(started.reason)
        await settle({ registry, shellId: started.snapshot.shellId })
        await recorded({ log })

        const ended = log?.appended.find((draft) => draft.type === 'background-shell-ended')
        expect(ended?.type === 'background-shell-ended' && ended.output.trim().endsWith(basename(root))).toBe(true)
      })
    })

    describe('reading a background shell back', async () => {
      it('collects what the command printed and reports its exit code', async () => {
        const { registry, log } = openRegistry({ adapter })
        const started = await registry.start(job({ command: 'echo hello' }))
        if (!started.ok) throw new Error(started.reason)

        await settle({ registry, shellId: started.snapshot.shellId })
        await recorded({ log })

        const ended = log?.appended.find((draft) => draft.type === 'background-shell-ended')
        expect(ended).toMatchObject({
          type: 'background-shell-ended',
          output: 'hello\n',
          status: EShellStatus.Exited,
          exitCode: 0,
        })
      })

      it('interleaves stderr with stdout, since one shell writes one stream of output', async () => {
        const { registry, log } = openRegistry({ adapter })
        const started = await registry.start(job({ command: 'echo out; echo err 1>&2' }))
        if (!started.ok) throw new Error(started.reason)

        await settle({ registry, shellId: started.snapshot.shellId })
        await recorded({ log })

        const ended = log?.appended.find((draft) => draft.type === 'background-shell-ended')
        const lines = ended?.type === 'background-shell-ended'
          ? ended.output.split('\n').filter(Boolean).sort()
          : []
        expect(lines).toEqual(['err', 'out'])
      })

      it('records the ending without consuming output, then advances only explicit reads', async () => {
        const { registry, log } = openRegistry({ adapter })
        const started = await registry.start(job({ command: 'echo once' }))
        if (!started.ok) throw new Error(started.reason)
        await settle({ registry, shellId: started.snapshot.shellId })
        await recorded({ log })

        const read = await registry.read({ shellId: started.snapshot.shellId, threadId: THREAD })

        expect(read.ok && read.delta.text).toBe('once\n')
        expect(read.ok && read.delta.remainingCharacters).toBe(0)
        const second = await registry.read({ shellId: started.snapshot.shellId, threadId: THREAD })
        expect(second.ok && second.delta.text).toBe('')
      })

      it('keeps a failing exit code rather than raising it', async () => {
        const { registry } = openRegistry({ adapter })
        const started = await registry.start(job({ command: 'echo nope; exit 3' }))
        if (!started.ok) throw new Error(started.reason)
        await settle({ registry, shellId: started.snapshot.shellId })
        const read = await registry.read({ shellId: started.snapshot.shellId, threadId: THREAD })

        expect(read.ok && read.snapshot.exitCode).toBe(3)
      })

      it('names the shells it knows when asked for one it does not', async () => {
        const { registry } = openRegistry({ adapter })
        const started = await registry.start(job({ command: 'sleep 30' }))
        if (!started.ok) throw new Error(started.reason)

        const read = await registry.read({ shellId: 'shell_unknown', threadId: THREAD })

        expect(read.ok).toBe(false)
        if (read.ok) return
        expect(read.reason).toContain('shell_unknown')
        expect(read.reason).toContain(started.snapshot.shellId)
      })

      it('says so when nothing is running at all', async () => {
        const { registry } = openRegistry({ adapter })

        const read = await registry.read({ shellId: 'shell_unknown', threadId: THREAD })

        expect(read.ok === false && read.reason).toContain('none is running')
      })
    })

    describe('looking at a shell without consuming it', async () => {
      it('peeks at the tail of a running shell without moving the cursor the model reads through', async () => {
        const { registry } = openRegistry({ adapter })
        const started = await registry.start(job({ command: 'printf "watched\\n"; sleep 30' }))
        if (!started.ok) throw new Error(started.reason)
        await printed({ registry, shellId: started.snapshot.shellId, text: 'watched' })

        const peeked = await registry.peek({
          shellId: started.snapshot.shellId,
          characters: 100,
          threadId: THREAD,
        })
        const read = await registry.read({ shellId: started.snapshot.shellId, threadId: THREAD })

        expect(peeked).toBe('watched\n')
        expect(read.ok && read.delta.text).toBe('watched\n')
      })

      it('peeks at nothing for a shell it does not know', async () => {
        const { registry } = openRegistry({ adapter })

        expect(
          await registry.peek({ shellId: 'shell_unknown', characters: 100, threadId: THREAD }),
        ).toBeUndefined()
      })
    })
  })
}
