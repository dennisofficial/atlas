import { readdir, readFile, stat } from 'node:fs/promises'

import { afterEach, describe, expect, it } from 'bun:test'

import {
  uploadWorkspaceArchive,
  WORKSPACE_UPLOAD_CONCURRENCY,
} from '../workspace-archive-transport'
import {
  CHUNK,
  completeInReverse,
  gatedSandbox,
  prepare,
  quiesce,
  releaseAll,
  removeScratchRoots,
} from './workspace-archive-transport-fixture'

afterEach(removeScratchRoots)

describe('concurrent chunk uploads', () => {
  it('defaults to eight concurrent writes', () => {
    expect(WORKSPACE_UPLOAD_CONCURRENCY).toBe(8)
  })

  it('keeps up to eight writes pending on independent buffers and starts no ninth until all settle', async () => {
    const { source, bytes, destination } = await prepare(CHUNK * 18)
    const gate = gatedSandbox()
    const upload = uploadWorkspaceArchive({
      sandbox: gate.sandbox,
      source,
      destination,
      chunkBytes: CHUNK,
      batchParts: 8,
    })

    await gate.whenStarted(8)
    await quiesce()
    expect(gate.started).toHaveLength(8)
    gate.started.forEach((write, index) => {
      expect(Buffer.compare(Buffer.from(write.content), bytes.subarray(index * CHUNK, (index + 1) * CHUNK))).toBe(0)
    })

    gate.started[3]?.release()
    gate.started[0]?.release()
    gate.started[2]?.release()
    await quiesce()
    expect(gate.started).toHaveLength(8)
    for (const write of gate.started.slice(1)) write.release()

    await gate.whenStarted(16)
    gate.started.slice(8, 16).forEach((write, index) => {
      expect(Buffer.compare(Buffer.from(write.content), bytes.subarray((index + 8) * CHUNK, (index + 9) * CHUNK))).toBe(0)
    })
    await releaseAll({ gate, total: 18 })
    await upload
    expect(gate.peak()).toBe(8)
  })

  it('assembles the exact bytes when writes complete in reverse order', async () => {
    const { source, bytes, drive, destination } = await prepare(CHUNK * 10 + 5)
    const gate = gatedSandbox()
    const upload = uploadWorkspaceArchive({
      sandbox: gate.sandbox,
      source,
      destination,
      chunkBytes: CHUNK,
      batchParts: 8,
    })

    await completeInReverse({ gate, waveSize: 4, waves: 2 })
    await gate.whenStarted(11)
    for (const write of gate.started.slice(8)) write.release()
    await upload

    expect(Buffer.compare(await readFile(destination), bytes)).toBe(0)
    expect(await readdir(drive)).toEqual(['workspace.tar.gz'])
  })

  it('bounds pending parts by batchParts and raw buffers by concurrency', async () => {
    const { source, bytes, destination } = await prepare(CHUNK * 20)
    const gate = gatedSandbox()
    const upload = uploadWorkspaceArchive({
      sandbox: gate.sandbox,
      source,
      destination,
      chunkBytes: CHUNK,
      batchParts: 2,
      concurrency: 4,
    })

    await completeInReverse({ gate, waveSize: 2, waves: 10 })
    await upload

    expect(gate.peak()).toBe(2)
    expect(Buffer.compare(await readFile(destination), bytes)).toBe(0)
    expect(Math.max(...gate.commands.map((command) => command.length))).toBeLessThan(1500)
  })

  it('never holds more raw buffers than the concurrency allows', async () => {
    const { source, destination } = await prepare(CHUNK * 20)
    const gate = gatedSandbox()
    const upload = uploadWorkspaceArchive({
      sandbox: gate.sandbox,
      source,
      destination,
      chunkBytes: CHUNK,
      batchParts: 8,
      concurrency: 3,
    })

    await releaseAll({ gate, total: 20 })
    await upload

    expect(gate.rawBuffers.size).toBeLessThanOrEqual(3)
    expect(gate.peak()).toBe(3)
  })

  it('uploads one chunk at a time when concurrency is 1', async () => {
    const { source, bytes, destination } = await prepare(CHUNK * 3)
    const gate = gatedSandbox()
    const upload = uploadWorkspaceArchive({
      sandbox: gate.sandbox,
      source,
      destination,
      chunkBytes: CHUNK,
      batchParts: 8,
      concurrency: 1,
    })

    for (let count = 1; count <= 3; count += 1) {
      await gate.whenStarted(count)
      await quiesce()
      expect(gate.started).toHaveLength(count)
      gate.started[count - 1]?.release()
    }
    await upload

    expect(gate.peak()).toBe(1)
    expect(Buffer.compare(await readFile(destination), bytes)).toBe(0)
  })

  it('publishes an empty file without any chunk write', async () => {
    const { source, destination } = await prepare(0)
    const gate = gatedSandbox()

    await uploadWorkspaceArchive({ sandbox: gate.sandbox, source, destination, chunkBytes: CHUNK })

    expect(gate.started).toHaveLength(0)
    expect((await stat(destination)).size).toBe(0)
  })

  it('writes a short final chunk after full ones', async () => {
    const { source, bytes, destination } = await prepare(CHUNK * 2 + 2)
    const gate = gatedSandbox()
    const upload = uploadWorkspaceArchive({ sandbox: gate.sandbox, source, destination, chunkBytes: CHUNK })

    await gate.whenStarted(3)
    expect(gate.started.map((write) => write.content.byteLength)).toEqual([CHUNK, CHUNK, 2])
    for (const write of gate.started) write.release()
    await upload

    expect(Buffer.compare(await readFile(destination), bytes)).toBe(0)
  })
})

