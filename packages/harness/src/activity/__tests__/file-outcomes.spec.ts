import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toThreadId } from '@dltech/atlas-core'
import type { ReadActivityReply } from '@dltech/atlas-wire'

import { createFileActivityOutcomes, FileActivityOutcomesUnavailableError } from '../file-outcomes'

const threadId = toThreadId('thread')
const completed: ReadActivityReply = {
  runtimeId: 'runtime-original',
  revision: 4,
  turnEpoch: 1,
  working: false,
  awaiting: null,
  observedOutcome: { identity: { kind: 'run', runId: 'actual-run' }, outcome: 'completed' },
}
let directory: string
let path: string
const createStore = (validateCurrent: () => Promise<ReadActivityReply> = async () => completed) =>
  createFileActivityOutcomes({ pathFor: async () => path, validateCurrent })

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'atlas-file-outcomes-'))
  path = join(directory, 'thread.activity.json')
})

afterEach(async () => {
  await readdir(directory)
  await rm(directory, { recursive: true, force: true })
})

describe('file activity outcomes', () => {
  it.each([
    { identity: { kind: 'run', runId: 'stopped-run' }, outcome: 'stopped' },
    { identity: { kind: 'run', runId: 'failed-run' }, outcome: 'failed' },
    {
      identity: { kind: 'driver-failure', runtimeId: 'runtime-original', revision: 3 },
      outcome: 'failed',
    },
  ] satisfies NonNullable<ReadActivityReply['observedOutcome']>[])(
    'retains actual terminal identity while background work remains live: %j',
    async (observedOutcome) => {
      const snapshot = { ...completed, working: true, observedOutcome }
      const store = createStore(async () => snapshot)
      expect(await store.observe({ threadId, candidate: snapshot })).toEqual({
        snapshot,
        outcome: observedOutcome,
      })
      expect(await createStore().read({ threadId })).toEqual(observedOutcome)
    },
  )

  it.each([false, true])(
    'persists an observed pre-turn driver failure at epoch zero, prior outcome: %s',
    async (seed) => {
      let current = completed
      const store = createStore(async () => current)
      if (seed) await store.observe({ threadId, candidate: completed })
      current = {
        ...completed,
        runtimeId: 'failed-before-turn',
        revision: 1,
        turnEpoch: 0,
        observedOutcome: {
          identity: { kind: 'driver-failure', runtimeId: 'failed-before-turn', revision: 1 },
          outcome: 'failed',
        },
      }
      expect((await store.observe({ threadId, candidate: current })).outcome).toEqual(
        current.observedOutcome,
      )
      expect(await createStore().read({ threadId })).toEqual(current.observedOutcome)
    },
  )

  it('retains a genuine outcome at runtime epoch zero and clears it only on an observed new start', async () => {
    await createStore().observe({ threadId, candidate: completed })
    let current: ReadActivityReply = {
      ...completed,
      runtimeId: 'replacement-runtime',
      revision: 0,
      turnEpoch: 0,
      observedOutcome: null,
    }
    const store = createStore(async () => current)
    expect(await store.observe({ threadId, candidate: current })).toEqual({
      snapshot: current,
      outcome: completed.observedOutcome,
    })
    expect(await createStore().read({ threadId })).toEqual(completed.observedOutcome)
    expect((await store.observe({ threadId, candidate: current })).outcome).toEqual(
      completed.observedOutcome,
    )
    current = { ...current, revision: 1 }
    expect((await store.observe({ threadId, candidate: current })).outcome).toEqual(
      completed.observedOutcome,
    )
    current = { ...current, revision: 2, turnEpoch: 1, working: true }
    expect(await store.observe({ threadId, candidate: current })).toEqual({
      snapshot: current,
      outcome: null,
    })
    expect(await createStore().read({ threadId })).toBeNull()
  })

  it.each([false, true])(
    'rejects a still-live old observer against fresh runtime proof, existing record: %s',
    async (seed) => {
      let current = completed
      const oldSocket = { read: async () => completed }
      const store = createStore(async () => {
        await expect(open(`${path}.lock`, 'wx')).rejects.toHaveProperty('code', 'EEXIST')
        return current
      })
      if (seed) await store.observe({ threadId, candidate: completed })
      const before = seed ? await readFile(path, 'utf8') : null
      current = {
        ...completed,
        runtimeId: 'a-new-runtime',
        revision: 0,
        turnEpoch: 0,
        observedOutcome: null,
      }
      await expect(
        store.observe({ threadId, candidate: await oldSocket.read() }),
      ).rejects.toBeInstanceOf(FileActivityOutcomesUnavailableError)
      if (before === null) expect(await store.read({ threadId })).toBeNull()
      else expect(await readFile(path, 'utf8')).toBe(before)
      await store.observe({ threadId, candidate: current })
      const replacement = await readFile(path, 'utf8')
      await expect(
        store.observe({ threadId, candidate: await oldSocket.read() }),
      ).rejects.toBeInstanceOf(FileActivityOutcomesUnavailableError)
      expect(await readFile(path, 'utf8')).toBe(replacement)
    },
  )

  it.each([
    '{malformed',
    JSON.stringify({ outcome: 'legacy-inference-is-not-a-record' }),
    JSON.stringify({
      format: 1,
      threadId: 'foreign',
      runtimeId: 'runtime',
      revision: 1,
      turnEpoch: 0,
      outcome: null,
    }),
    JSON.stringify({
      format: 2,
      threadId,
      runtimeId: 'runtime',
      revision: 1,
      turnEpoch: 0,
      outcome: null,
    }),
    JSON.stringify({
      format: 1,
      threadId,
      runtimeId: 'runtime',
      revision: -1,
      turnEpoch: 0,
      outcome: null,
    }),
    JSON.stringify({
      format: 1,
      threadId,
      runtimeId: 'runtime',
      revision: 1,
      turnEpoch: 0,
      outcome: null,
      working: true,
    }),
    JSON.stringify({
      format: 1,
      threadId,
      runtimeId: 'runtime',
      revision: 1,
      turnEpoch: 1,
      outcome: { identity: { kind: 'run' }, outcome: 'completed' },
    }),
  ])('refuses malformed records without overwriting them: %s', async (contents) => {
    await writeFile(path, contents)
    const store = createStore()
    await expect(store.read({ threadId })).rejects.toBeInstanceOf(
      FileActivityOutcomesUnavailableError,
    )
    await expect(store.observe({ threadId, candidate: completed })).rejects.toBeInstanceOf(
      FileActivityOutcomesUnavailableError,
    )
    expect(await readFile(path, 'utf8')).toBe(contents)
  })

  it('persists only freshly validated facts while locked and reconstructs a genuinely observed outcome', async () => {
    let validations = 0
    const store = createStore(async () => {
      validations += 1
      await expect(open(`${path}.lock`, 'wx')).rejects.toHaveProperty('code', 'EEXIST')
      return completed
    })
    const candidate = { ...completed, revision: 1, working: true, observedOutcome: null }
    expect(await store.observe({ threadId, candidate })).toEqual({
      snapshot: completed,
      outcome: completed.observedOutcome,
    })
    expect(validations).toBe(1)
    expect(await createStore().read({ threadId })).toEqual(completed.observedOutcome)
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      format: 1,
      threadId,
      runtimeId: 'runtime-original',
      revision: 4,
      turnEpoch: 1,
      outcome: { identity: { kind: 'run', runId: 'actual-run' }, outcome: 'completed' },
    })
    expect(await readdir(directory)).toEqual(['thread.activity.json'])
  })

  it('returns unknown without a record and never validates or invents an outcome on read', async () => {
    await writeFile(
      join(directory, 'legacy-thread.json'),
      JSON.stringify({ lastOutcome: 'completed', head: 99 }),
    )
    const store = createStore(async () => {
      throw new Error('must not inspect on read')
    })
    expect(await store.read({ threadId })).toBeNull()
    expect(await readdir(directory)).toEqual(['legacy-thread.json'])
  })
})
