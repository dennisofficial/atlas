import { EContextFileKind } from '@dltech/atlas-core'
import { FakeContextContentStore } from '@dltech/atlas-control/testing'
import { describe, expect, it } from 'bun:test'

import {
  announceChanged,
  binaryOf,
  bytesOf,
  fakeFs,
  NOW,
  putFile,
  removeFile,
  rig,
  ROOT,
  rowsOf,
  SESSION,
  settle,
  until,
} from './context-mirror-rig'

const WATCH_ID = `context-${SESSION}`

describe('ContextMirror', () => {
  it('mirrors text, binary and nested files on start', async () => {
    const fs = fakeFs()
    const notes = bytesOf('# the plan\n')
    const picture = binaryOf(0x89, 0x50, 0x4e, 0x47, 0x00, 0x01)
    putFile({ fs, path: 'notes.md', bytes: notes })
    putFile({ fs, path: 'images/pic.png', bytes: picture })
    putFile({ fs, path: 'sections/03-auth.md', text: 'the auth section' })
    const { mirror, plane, announces, errors, content } = await rig({ fs })

    mirror.start()
    await until(async () => (await rowsOf({ plane })).length === 3)

    const rows = await rowsOf({ plane })
    expect(errors).toEqual([])
    expect(rows.map((row) => row.path)).toEqual([
      'images/pic.png',
      'notes.md',
      'sections/03-auth.md',
    ])
    expect(rows.find((row) => row.path === 'notes.md')).toMatchObject({
      digest: FakeContextContentStore.hashOf(notes),
      size: notes.byteLength,
      mime: 'text/markdown',
      kind: EContextFileKind.Text,
      mtimeMs: 1_700_000_000_000,
    })
    expect(rows.find((row) => row.path === 'images/pic.png')).toMatchObject({
      digest: FakeContextContentStore.hashOf(picture),
      mime: 'image/png',
      kind: EContextFileKind.Image,
    })
    expect(content.puts).toHaveLength(3)
    expect(announces).toEqual([['notes.md', 'images/pic.png', 'sections/03-auth.md']])
    expect(fs.watchRoots).toEqual([[ROOT]])
    await mirror.stop()
    expect(fs.stopped).toEqual([WATCH_ID])
  })

  it('leaves an unchanged file alone', async () => {
    const fs = fakeFs()
    putFile({ fs, path: 'notes.md', text: 'one' })
    const { mirror, plane, announces, content } = await rig({ fs })

    await mirror.rescanNow()
    fs.digests.length = 0
    await mirror.rescanNow()

    expect(fs.digests).toEqual([])
    expect(content.puts).toHaveLength(1)
    expect(announces).toHaveLength(1)
    expect(await rowsOf({ plane })).toHaveLength(1)
  })

  it('replaces the row and stores the new bytes when a file is overwritten', async () => {
    const fs = fakeFs()
    putFile({ fs, path: 'notes.md', text: 'one' })
    const { mirror, plane, announces, content } = await rig({ fs })
    await mirror.rescanNow()
    const second = bytesOf('one two')
    putFile({ fs, path: 'notes.md', bytes: second, mtimeMs: 1_700_000_001_000 })

    await mirror.rescanNow()

    const rows = await rowsOf({ plane })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.digest).toBe(FakeContextContentStore.hashOf(second))
    expect(rows[0]?.size).toBe(second.byteLength)
    expect(rows[0]?.mtimeMs).toBe(1_700_000_001_000)
    expect(content.puts).toEqual([
      FakeContextContentStore.hashOf(bytesOf('one')),
      FakeContextContentStore.hashOf(second),
    ])
    expect(announces.at(-1)).toEqual(['notes.md'])
  })

  it('removes the row of a file that is gone', async () => {
    const fs = fakeFs()
    putFile({ fs, path: 'notes.md', text: 'one' })
    putFile({ fs, path: 'other.md', text: 'two' })
    const { mirror, plane, announces } = await rig({ fs })
    await mirror.rescanNow()
    removeFile({ fs, path: 'notes.md' })

    await mirror.rescanNow()

    expect((await rowsOf({ plane })).map((row) => row.path)).toEqual(['other.md'])
    expect(announces.at(-1)).toEqual(['notes.md'])
  })

  it('mirrors a file of any size without reading it onto the host', async () => {
    const fs = fakeFs()
    const bytes = binaryOf(1, 0, 3)
    putFile({ fs, path: 'huge.bin', bytes, size: 12 * 1024 * 1024 })
    const { mirror, plane, content } = await rig({ fs })

    await mirror.rescanNow()

    const rows = await rowsOf({ plane })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      path: 'huge.bin',
      digest: FakeContextContentStore.hashOf(bytes),
      size: 12 * 1024 * 1024,
      mime: 'application/octet-stream',
      kind: EContextFileKind.Binary,
    })
    expect(fs.reads).toEqual([])
    expect(content.puts).toEqual([FakeContextContentStore.hashOf(bytes)])
  })

  it('uploads the bytes before it writes the index row', async () => {
    const fs = fakeFs()
    putFile({ fs, path: 'notes.md', text: 'one' })
    putFile({ fs, path: 'other.md', text: 'two' })
    const { mirror, order } = await rig({ fs })

    await mirror.rescanNow()

    const firstUpload = order.findIndex((entry) => entry.startsWith('presignPut:'))
    const upsert = order.findIndex((entry) => entry.startsWith('upsert:'))
    expect(firstUpload).toBeGreaterThanOrEqual(0)
    expect(upsert).toBeGreaterThan(firstUpload)
  })

  it('leaves a stored object alone and only writes the row', async () => {
    const fs = fakeFs()
    const bytes = bytesOf('one')
    putFile({ fs, path: 'notes.md', bytes })
    const { mirror, content } = await rig({ fs })
    await content.put({ hash: FakeContextContentStore.hashOf(bytes), bytes })

    await mirror.rescanNow()

    expect(content.puts).toHaveLength(1)
  })

  it('re-mirrors a row whose mime or media kind the old rules got wrong', async () => {
    const fs = fakeFs()
    const bytes = binaryOf(0)
    putFile({ fs, path: 'media/walkthrough.mp4', bytes })
    const { mirror, plane } = await rig({ fs })
    await plane.upsertContextFiles({
      sessionId: SESSION,
      files: [
        {
          path: 'media/walkthrough.mp4',
          digest: FakeContextContentStore.hashOf(bytes),
          size: 1,
          mime: 'application/octet-stream',
          kind: EContextFileKind.Binary,
          mtimeMs: NOW,
        },
      ],
    })

    await mirror.rescanNow()

    expect((await rowsOf({ plane }))[0]).toMatchObject({
      mime: 'video/mp4',
      kind: EContextFileKind.Video,
    })
  })

  it('announces one set of paths per change and nothing when nothing changed', async () => {
    const fs = fakeFs()
    putFile({ fs, path: 'notes.md', text: 'one' })
    const { mirror, announces } = await rig({ fs })

    await mirror.rescanNow()
    await mirror.rescanNow()

    expect(announces).toEqual([['notes.md']])
  })

  it('debounces a burst of watch events into one rescan', async () => {
    const fs = fakeFs()
    putFile({ fs, path: 'notes.md', text: 'one' })
    const { mirror, plane } = await rig({ fs })
    mirror.start()
    await until(async () => (await rowsOf({ plane })).length === 1)
    const before = fs.scans

    announceChanged({ fs, watchId: WATCH_ID, paths: ['notes.md'] })
    announceChanged({ fs, watchId: WATCH_ID, paths: ['notes.md'] })
    announceChanged({ fs, watchId: WATCH_ID, paths: ['notes.md'] })
    await settle(200)
    expect(fs.scans).toBe(before)
    await until(() => fs.scans > before)
    await settle(300)

    expect(fs.scans - before).toBe(1)
    await mirror.stop()
  })

  it('stops watching and ignores events after stop', async () => {
    const fs = fakeFs()
    putFile({ fs, path: 'notes.md', text: 'one' })
    const { mirror, plane } = await rig({ fs })
    mirror.start()
    await until(async () => (await rowsOf({ plane })).length === 1)
    await mirror.stop()
    const before = fs.scans

    announceChanged({ fs, watchId: WATCH_ID, paths: ['notes.md'] })
    await settle(1_200)

    expect(fs.stopped).toEqual([WATCH_ID])
    expect(fs.scans).toBe(before)
  })

  it('keeps the other files when one upload fails', async () => {
    const fs = fakeFs()
    putFile({ fs, path: 'broken.md', text: 'one' })
    putFile({ fs, path: 'fine.md', text: 'two' })
    fs.failDigests.add(`${ROOT}/broken.md`)
    const { mirror, plane, errors } = await rig({ fs })

    await mirror.rescanNow()

    expect((await rowsOf({ plane })).map((row) => row.path)).toEqual(['fine.md'])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('broken.md')
  })
})
