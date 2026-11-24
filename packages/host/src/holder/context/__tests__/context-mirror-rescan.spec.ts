import { describe, expect, it } from 'bun:test'

import { fakeFs, putFile, removeFile, rig, ROOT, rowsOf } from './context-mirror-rig'

describe('ContextMirror publishing', () => {
  it('stores each file before it indexes the next one', async () => {
    const fs = fakeFs()
    putFile({ fs, path: 'a.md', text: 'one' })
    putFile({ fs, path: 'b.md', text: 'two' })
    const { mirror, order } = await rig({ fs })

    await mirror.rescanNow()

    expect(interleaved(order)).toEqual(['store', 'upsert', 'store', 'upsert'])
  })
})

describe('ContextMirror rescanning', () => {
  it('indexes a file written during the scan before rescanNow resolves', async () => {
    const fs = fakeFs()
    putFile({ fs, path: 'notes.md', text: 'one' })
    const { mirror, plane } = await rig({ fs })
    await mirror.rescanNow()
    let once = true
    fs.onScan = () => {
      if (!once) return
      once = false
      putFile({ fs, path: 'late.md', text: 'two', mtimeMs: 1_700_000_009_000 })
      void mirror.rescanNow()
    }

    await mirror.rescanNow()

    expect((await rowsOf({ plane })).map((row) => row.path)).toEqual(['late.md', 'notes.md'])
  })
})

describe('ContextMirror removing rows', () => {
  it('keeps the rows under a directory it could not read', async () => {
    const fs = fakeFs()
    putFile({ fs, path: 'notes.md', text: 'one' })
    putFile({ fs, path: 'locked/kept.md', text: 'two' })
    const { mirror, plane, announces } = await rig({ fs })
    await mirror.rescanNow()
    removeFile({ fs, path: 'notes.md' })
    removeFile({ fs, path: 'locked/kept.md' })
    fs.failDirs.add(`${ROOT}/locked`)

    await mirror.rescanNow()

    expect((await rowsOf({ plane })).map((row) => row.path)).toEqual(['locked/kept.md'])
    expect(announces.at(-1)).toEqual(['notes.md'])
  })

  it('keeps the row of a file whose stat failed', async () => {
    const fs = fakeFs()
    putFile({ fs, path: 'notes.md', text: 'one' })
    const { mirror, plane } = await rig({ fs })
    await mirror.rescanNow()
    fs.failStats.add(`${ROOT}/notes.md`)

    await mirror.rescanNow()

    expect((await rowsOf({ plane })).map((row) => row.path)).toEqual(['notes.md'])
  })
})

const interleaved = (order: readonly string[]): readonly string[] => {
  const steps: string[] = []
  for (const entry of order) {
    const kind = entry.startsWith('upsert:') ? 'upsert' : 'store'
    if (steps.at(-1) === kind) continue
    steps.push(kind)
  }
  return steps
}
