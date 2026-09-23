import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { installHeapDumpSignal, writeHeapDump } from '../heap-dump'

describe('writeHeapDump', () => {
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'atlas-heapdump-'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('writes a parseable V8 heap snapshot and clears the partial file', async () => {
    const file = await writeHeapDump({ directory })

    expect(file.endsWith('.heapsnapshot')).toBe(true)
    expect(file.startsWith(directory)).toBe(true)

    const parsed = JSON.parse(await readFile(file, 'utf8')) as { snapshot: { meta: unknown } }
    expect(parsed.snapshot.meta).toBeDefined()

    const entries = await readdir(directory)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.endsWith('.partial')).toBe(false)
  })

  it('shares one dump across concurrent callers', async () => {
    const [first, second] = await Promise.all([
      writeHeapDump({ directory }),
      writeHeapDump({ directory }),
    ])

    expect(second).toBe(first)
    expect(await readdir(directory)).toHaveLength(1)
  })
})

describe('installHeapDumpSignal', () => {
  afterEach(() => {
    process.removeAllListeners('SIGUSR2')
  })

  it('dumps on SIGUSR2 and reports the file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'atlas-heapdump-signal-'))

    try {
      const done = new Promise<{ text: string; failed: boolean }>((resolve) => {
        installHeapDumpSignal({ directory, onDone: resolve })
      })

      process.emit('SIGUSR2')

      const result = await done
      expect(result.failed).toBe(false)
      expect(result.text).toContain('.heapsnapshot')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
