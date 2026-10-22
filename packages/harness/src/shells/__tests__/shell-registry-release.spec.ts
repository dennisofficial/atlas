import { afterEach, describe, expect, it } from 'bun:test'
import { dirname, join } from 'node:path'

import { loadCursor, ENDED_READ_BYTES } from '../output-preview'
import { SHELL_CURSOR_FILE_NAME } from '../storage'
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

async function persistedRead({ path, read }: { path: string; read: number }): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if ((await loadCursor({ path })).cursor.read === read) return
    await Bun.sleep(25)
  }
  expect((await loadCursor({ path })).cursor.read).toBe(read)
}

for (const adapter of shellAdapters) {
  const describeAdapter = adapter.available ? describe : describe.skip

  describeAdapter(`${adapter.name} process adapter`, () => {
    describe('persisting the output of a dead shell', async () => {
      it('keeps the spool after the ending and consumes only the read cursor', async () => {
        const { registry, log } = openRegistry({ adapter })
        const started = await registry.start(job({ command: 'echo delivered' }))
        if (!started.ok) throw new Error(started.reason)
        await settle({ registry, shellId: started.snapshot.shellId })
        await recorded({ log })

        const delivered = endedDraft(log?.appended.find((draft) => draft.type === 'background-shell-ended'))
        const outputPath = delivered.outputPath
        if (outputPath === undefined) throw new Error('the ending must name its spool')
        const cursorPath = join(dirname(outputPath), SHELL_CURSOR_FILE_NAME)
        expect((await loadCursor({ path: cursorPath })).cursor.read).toBe(0)
        expect(delivered.output).toBe('delivered\n')
        expect(await registry.peek({ shellId: started.snapshot.shellId, characters: 1000, threadId: THREAD })).toBe(delivered.output)

        const read = await registry.read({ shellId: started.snapshot.shellId, threadId: THREAD })
        expect(read.ok && read.delta.text).toBe(delivered.output)
        expect(read.ok && read.delta.remainingCharacters).toBe(0)
        await persistedRead({ path: cursorPath, read: delivered.output.length })

        const second = await registry.read({ shellId: started.snapshot.shellId, threadId: THREAD })
        expect(second.ok && second.delta.text).toBe('')
        expect(await Bun.file(outputPath).text()).toBe(delivered.output)
        expect(await registry.peek({ shellId: started.snapshot.shellId, characters: 1000, threadId: THREAD })).toBe(delivered.output)
      })

      it('keeps logless output readable after the bell without consuming the spool', async () => {
        const { registry } = openRegistry({ adapter, log: null })
        const started = await registry.start(job({ command: 'echo still-waiting' }))
        if (!started.ok) throw new Error(started.reason)
        await settle({ registry, shellId: started.snapshot.shellId })
        await announced({ registry })

        expect(await registry.peek({ shellId: started.snapshot.shellId, characters: 1000, threadId: THREAD })).toBe('still-waiting\n')
        registry.prepareNotifications({ threadId: THREAD }).acknowledge()
        const read = await registry.read({ shellId: started.snapshot.shellId, threadId: THREAD })
        if (!read.ok) throw new Error(read.reason)
        expect(read.delta.text).toBe('still-waiting\n')
        const second = await registry.read({ shellId: started.snapshot.shellId, threadId: THREAD })
        expect(second.ok && second.delta.text).toBe('')
        if (read.snapshot.outputPath === undefined) throw new Error('the shell must name its spool')
        expect(await Bun.file(read.snapshot.outputPath).text()).toBe('still-waiting\n')
      })

      it('announces only the tail while bounded reads and independent file searches recover the whole spool', async () => {
        const { registry, log } = openRegistry({ adapter })
        const started = await registry.start(job({ command: "printf 'BEGIN\n'; head -c 450000 /dev/zero | tr '\\0' x; printf '\nEND\n'" }))
        if (!started.ok) throw new Error(started.reason)
        await settle({ registry, shellId: started.snapshot.shellId })
        await recorded({ log })

        const delivered = endedDraft(log?.appended.find((draft) => draft.type === 'background-shell-ended'))
        const full = `BEGIN\n${'x'.repeat(450_000)}\nEND\n`
        expect(delivered.output).toBe(full.slice(-8192))
        expect(delivered).toMatchObject({ outputStart: full.length - 8192, outputEnd: full.length, remainingCharacters: 0, droppedCharacters: 0 })
        const outputPath = delivered.outputPath
        if (outputPath === undefined) throw new Error('the ending must name its spool')
        const cursorPath = join(dirname(outputPath), SHELL_CURSOR_FILE_NAME)
        expect((await loadCursor({ path: cursorPath })).cursor.read).toBe(0)

        const read = await registry.read({ shellId: started.snapshot.shellId, threadId: THREAD })
        expect(read.ok && read.delta.text).toBe(full.slice(0, ENDED_READ_BYTES))
        expect(read.ok && read.delta.remainingCharacters).toBe(full.length - ENDED_READ_BYTES)
        await persistedRead({ path: cursorPath, read: ENDED_READ_BYTES })
        const remainder = await registry.read({ shellId: started.snapshot.shellId, threadId: THREAD })
        expect(remainder.ok && remainder.delta.text).toBe(full.slice(ENDED_READ_BYTES))
        expect(remainder.ok && remainder.delta.remainingCharacters).toBe(0)
        const consumed = await registry.read({ shellId: started.snapshot.shellId, threadId: THREAD })
        expect(consumed.ok && consumed.delta.text).toBe('')
        await persistedRead({ path: cursorPath, read: full.length })

        const spool = await Bun.file(outputPath).text()
        expect(spool).toBe(full)
        expect(spool.match(/^(BEGIN|END)$/gm)).toEqual(['BEGIN', 'END'])
        expect(await registry.peek({ shellId: started.snapshot.shellId, characters: 1000, threadId: THREAD })).toBe(full.slice(-1000))
      })
    })
  })
}
