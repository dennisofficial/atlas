import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'

import { afterEach, describe, expect, it } from 'bun:test'

import type { TransferProgress } from '../transfer-progress'
import { uploadWorkspaceArchive } from '../workspace-archive-transport'
import {
  CHUNK,
  gatedSandbox,
  prepare,
  quiesce,
  removeScratchRoots,
} from './workspace-archive-transport-fixture'

afterEach(removeScratchRoots)

describe('a failure during a concurrent wave', () => {
  it('waits for the blocked sibling before cleaning up, launches no later wave, and keeps the old destination', async () => {
    const { source, drive, destination } = await prepare(CHUNK * 10)
    await mkdir(drive, { recursive: true })
    await writeFile(destination, 'previous archive')
    const gate = gatedSandbox()
    let settled = false
    const outcome = uploadWorkspaceArchive({
      sandbox: gate.sandbox,
      source,
      destination,
      chunkBytes: CHUNK,
      batchParts: 8,
    }).then(
      () => {
        settled = true
        return undefined
      },
      (error: unknown) => {
        settled = true
        return error
      },
    )

    await gate.whenStarted(8)
    gate.started[1]?.fail(new Error('the second write failed'))
    gate.started[2]?.release()
    await quiesce()

    expect(settled).toBe(false)
    expect(gate.commands.some((command) => command.includes('rm -rf'))).toBe(false)
    expect(gate.started).toHaveLength(8)

    gate.started[0]?.release()
    for (const write of gate.started.slice(3)) write.release()
    const error = await outcome

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('the second write failed')
    expect(gate.started).toHaveLength(8)
    expect(gate.commands.at(-1)).toContain('rm -rf')
    expect(await readFile(destination, 'utf8')).toBe('previous archive')
    expect(await readdir(drive)).toEqual(['workspace.tar.gz'])
  })
})

describe('progress under concurrency', () => {
  it('counts acknowledged writes in any order, monotonically, and completes only after publication', async () => {
    const { source, destination } = await prepare(CHUNK * 4)
    const gate = gatedSandbox()
    const events: TransferProgress[] = []
    const upload = uploadWorkspaceArchive({
      sandbox: gate.sandbox,
      source,
      destination,
      chunkBytes: CHUNK,
      batchParts: 8,
      onProgress: (progress) => events.push(progress),
    })

    await gate.whenStarted(4)
    gate.started[2]?.release()
    await quiesce()
    expect(events.at(-1)).toEqual({ transferredBytes: CHUNK, totalBytes: CHUNK * 4, complete: false })
    gate.started[0]?.release()
    await quiesce()
    expect(events.at(-1)).toEqual({ transferredBytes: CHUNK * 2, totalBytes: CHUNK * 4, complete: false })
    gate.started[3]?.release()
    gate.started[1]?.release()
    await upload

    expect(events.map((event) => event.transferredBytes)).toEqual([0, 64, 128, 192, 256, 256])
    expect(events.map((event) => event.complete)).toEqual([false, false, false, false, false, true])
  })
})

describe('upload argument validation', () => {
  it.each([
    { name: 'chunkBytes', value: 0 },
    { name: 'chunkBytes', value: 1.5 },
    { name: 'batchParts', value: 0 },
    { name: 'batchParts', value: -1 },
    { name: 'concurrency', value: 0 },
    { name: 'concurrency', value: Number.NaN },
  ])('rejects $name $value before touching the sandbox', async ({ name, value }) => {
    const { source, destination } = await prepare(10)
    const gate = gatedSandbox()

    await expect(
      uploadWorkspaceArchive({ sandbox: gate.sandbox, source, destination, [name]: value }),
    ).rejects.toThrow(name)

    expect(gate.started).toHaveLength(0)
    expect(gate.commands).toHaveLength(0)
  })
})
