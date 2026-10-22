import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createLedger } from '../rig-ledger'

describe('createLedger', () => {
  let dir = ''

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rig-ledger-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('starts empty and creates no file until the first add', async () => {
    const file = join(dir, 'ledger.json')
    const ledger = createLedger({ file })

    expect(await ledger.entries()).toEqual([])
    expect(await ledger.has('atlas-a')).toBe(false)
    expect(await stat(file).catch(() => null)).toBeNull()
  })

  test('appends entries and answers has', async () => {
    const file = join(dir, 'out', 'ledger.json')
    const ledger = createLedger({ file })
    await ledger.add({ name: 'atlas-a', threadId: 'thr_a' })
    await ledger.add({ name: 'atlas-b', threadId: 'thr_b' })

    const entries = await ledger.entries()
    expect(entries.map(({ name, threadId }) => ({ name, threadId }))).toEqual([
      { name: 'atlas-a', threadId: 'thr_a' },
      { name: 'atlas-b', threadId: 'thr_b' },
    ])
    expect(entries.every((entry) => !Number.isNaN(Date.parse(entry.at)))).toBe(true)
    expect(await ledger.has('atlas-b')).toBe(true)
    expect(await ledger.has('atlas-c')).toBe(false)
  })

  test('keeps concurrent adds', async () => {
    const ledger = createLedger({ file: join(dir, 'ledger.json') })
    await Promise.all(
      ['one', 'two', 'three'].map((name) => ledger.add({ name, threadId: `thr_${name}` })),
    )

    expect((await ledger.entries()).map((entry) => entry.name)).toEqual(['one', 'two', 'three'])
  })

  test('survives a fresh createLedger on the same file', async () => {
    const file = join(dir, 'ledger.json')
    await createLedger({ file }).add({ name: 'atlas-a', threadId: 'thr_a' })

    const reopened = createLedger({ file })
    expect(await reopened.has('atlas-a')).toBe(true)
    await reopened.add({ name: 'atlas-b', threadId: 'thr_b' })

    const onDisk: unknown = JSON.parse(await readFile(file, 'utf8'))
    expect(Array.isArray(onDisk) ? onDisk.length : -1).toBe(2)
  })
})
