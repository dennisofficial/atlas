import { readFile, stat } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'bun:test'

import { EShellStatus } from '@dltech/atlas-core'
import { closeRegistries, endedDraft, job, openRegistry, recorded, settle, THREAD } from './shell-registry-fixture'

const CAP_BYTES = 64 * 1024

afterEach(closeRegistries)

describe('a durable shell’s output cap', () => {
  it('bounds the append-only spool in the kernel and records a confirmed SIGXFSZ overflow', async () => {
    const { registry, log } = openRegistry()
    const started = await registry.start({ ...job({ command: 'exec yes y' }), outputLimitBytes: CAP_BYTES })
    if (!started.ok) throw new Error(started.reason)
    await settle({ registry, shellId: started.snapshot.shellId })
    await recorded({ log })

    const ended = endedDraft(log?.appended.find((draft) => draft.type === 'background-shell-ended'))
    expect(ended.status).toBe(EShellStatus.Overflowed)
    expect(ended.output.length).toBeLessThanOrEqual(8192)
    expect(ended.droppedCharacters).toBe(0)
    const path = started.snapshot.outputPath
    if (path === undefined) throw new Error('a durable shell must name its spool')
    expect((await stat(path)).size).toBe(CAP_BYTES)
    expect((await readFile(path)).length).toBe(CAP_BYTES)
    const read = await registry.read({ threadId: THREAD, shellId: started.snapshot.shellId })
    expect(read.ok && Buffer.byteLength(read.delta.text)).toBe(CAP_BYTES)
  })

  it('keeps full output beyond an inline read without dropping or rotating bytes', async () => {
    const { registry, log } = openRegistry()
    const started = await registry.start(job({ command: 'yes y | head -c 401000' }))
    if (!started.ok) throw new Error(started.reason)
    await settle({ registry, shellId: started.snapshot.shellId })
    await recorded({ log })
    const path = started.snapshot.outputPath
    if (path === undefined) throw new Error('a durable shell must name its spool')
    const bytes = await readFile(path)
    expect(bytes.length).toBe(401000)
    const ended = endedDraft(log?.appended.find((draft) => draft.type === 'background-shell-ended'))
    expect(ended.droppedCharacters).toBe(0)
    expect(ended.output).toBe(bytes.subarray(-8192).toString())
    const first = await registry.read({ threadId: THREAD, shellId: started.snapshot.shellId })
    const second = await registry.read({ threadId: THREAD, shellId: started.snapshot.shellId })
    if (!first.ok || !second.ok) throw new Error('the retained shell must stay readable')
    expect(first.delta.droppedCharacters).toBe(0)
    expect(second.delta.droppedCharacters).toBe(0)
    expect(first.delta.text + second.delta.text).toBe(bytes.toString())
    expect(await readFile(path)).toEqual(bytes)
  })
})
