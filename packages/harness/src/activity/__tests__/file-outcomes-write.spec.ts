import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toThreadId } from '@dltech/atlas-core'
import type { ReadActivityReply } from '@dltech/atlas-wire'

import { createFileActivityOutcomes, FileActivityOutcomesUnavailableError } from '../file-outcomes'

const threadId = toThreadId('thread')
const initial: ReadActivityReply = {
  runtimeId: 'runtime',
  revision: 4,
  turnEpoch: 1,
  working: false,
  awaiting: null,
  observedOutcome: { identity: { kind: 'run', runId: 'actual-run' }, outcome: 'completed' },
}
let directory: string
let path: string
let current: ReadActivityReply
const createStore = () =>
  createFileActivityOutcomes({
    pathFor: async () => path,
    validateCurrent: async () => current,
  })

beforeEach(async () => {
  directory = await fs.mkdtemp(join(tmpdir(), 'atlas-file-outcomes-write-'))
  path = join(directory, 'thread.activity.json')
  current = initial
})

afterEach(async () => {
  await fs.readdir(directory)
  await fs.rm(directory, { recursive: true, force: true })
})

describe('file activity outcome writes', () => {
  it.each([false, true])(
    'preserves an original or missing record when current endpoint validation fails: %s',
    async (seed) => {
      const store = createStore()
      if (seed) await store.observe({ threadId, candidate: initial })
      const before = seed ? await fs.readFile(path, 'utf8') : null
      const failure = new Error('current authenticated endpoint unavailable')
      const unavailable = createFileActivityOutcomes({
        pathFor: async () => path,
        validateCurrent: async () => {
          await expect(fs.open(`${path}.lock`, 'wx')).rejects.toHaveProperty('code', 'EEXIST')
          throw failure
        },
      })
      await expect(unavailable.observe({ threadId, candidate: initial })).rejects.toBe(failure)
      if (before === null) expect(await fs.readdir(directory)).toEqual([])
      else expect(await fs.readFile(path, 'utf8')).toBe(before)
      expect((await store.observe({ threadId, candidate: initial })).outcome).toEqual(
        initial.observedOutcome,
      )
    },
  )

  it('does not unlink a foreign temporary replacement during failed-write cleanup', async () => {
    const store = createStore()
    await store.observe({ threadId, candidate: initial })
    const before = await fs.readFile(path, 'utf8')
    current = { ...initial, revision: 5, observedOutcome: null }
    const originalRename = fs.rename
    let replaced = ''
    const rename = spyOn(fs, 'rename').mockImplementationOnce(async (source) => {
      if (typeof source !== 'string') throw new Error('Expected a temporary path')
      replaced = source
      await originalRename(source, `${path}.displaced-temp`)
      await fs.writeFile(source, 'foreign temporary claim')
      throw new Error('rename refused after replacement')
    })
    try {
      await expect(store.observe({ threadId, candidate: current })).rejects.toBeInstanceOf(
        FileActivityOutcomesUnavailableError,
      )
    } finally {
      rename.mockRestore()
    }
    expect(await fs.readFile(replaced, 'utf8')).toBe('foreign temporary claim')
    expect(await fs.readFile(path, 'utf8')).toBe(before)
  })

  it('does not rename or mutate the original record after fsync failure and can retry', async () => {
    const store = createStore()
    await store.observe({ threadId, candidate: initial })
    const before = await fs.readFile(path, 'utf8')
    const handle = await fs.open(path, 'r')
    const prototype: Pick<fs.FileHandle, 'sync'> = Object.getPrototypeOf(handle)
    await handle.close()
    current = { ...initial, revision: 5, observedOutcome: null }
    const rename = spyOn(fs, 'rename')
    const sync = spyOn(prototype, 'sync').mockImplementationOnce(async () => {
      await expect(fs.open(`${path}.lock`, 'wx')).rejects.toHaveProperty('code', 'EEXIST')
      throw new Error('fsync refused')
    })
    try {
      await expect(store.observe({ threadId, candidate: current })).rejects.toBeInstanceOf(
        FileActivityOutcomesUnavailableError,
      )
      expect(sync).toHaveBeenCalledTimes(1)
      expect(rename).not.toHaveBeenCalled()
    } finally {
      sync.mockRestore()
      rename.mockRestore()
    }
    expect(await fs.readFile(path, 'utf8')).toBe(before)
    expect(await fs.readdir(directory)).toEqual(['thread.activity.json'])
    expect((await store.observe({ threadId, candidate: current })).outcome).toBeNull()
  })

  it('preserves the original record and removes its temporary file after rename failure, then retries', async () => {
    const store = createStore()
    await store.observe({ threadId, candidate: initial })
    const before = await fs.readFile(path, 'utf8')
    current = { ...initial, revision: 5, observedOutcome: null }
    const rename = spyOn(fs, 'rename').mockRejectedValueOnce(new Error('rename refused'))
    try {
      await expect(store.observe({ threadId, candidate: current })).rejects.toBeInstanceOf(
        FileActivityOutcomesUnavailableError,
      )
      expect(rename).toHaveBeenCalledTimes(1)
    } finally {
      rename.mockRestore()
    }
    expect(await fs.readFile(path, 'utf8')).toBe(before)
    expect(await fs.readdir(directory)).toEqual(['thread.activity.json'])
    expect((await store.observe({ threadId, candidate: current })).outcome).toBeNull()
    expect(await store.read({ threadId })).toBeNull()
  })
})
