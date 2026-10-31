import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, readdir, rm, stat, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toThreadId } from '@dltech/atlas-core'
import type { ReadActivityReply } from '@dltech/atlas-wire'

import { createFileActivityOutcomes, FileActivityOutcomesUnavailableError } from '../file-outcomes'

const threadId = toThreadId('thread')
const initial: ReadActivityReply = {
  runtimeId: 'runtime',
  revision: 4,
  turnEpoch: 2,
  working: false,
  awaiting: null,
  observedOutcome: { identity: { kind: 'run', runId: 'actual-run' }, outcome: 'completed' },
}
let directory: string
let path: string
let current: ReadActivityReply
const createStore = (validateCurrent: () => Promise<ReadActivityReply> = async () => current) =>
  createFileActivityOutcomes({
    pathFor: async () => path,
    validateCurrent,
  })

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'atlas-file-outcomes-cas-'))
  path = join(directory, 'thread.activity.json')
  current = initial
})

afterEach(async () => {
  await readdir(directory)
  await rm(directory, { recursive: true, force: true })
})

describe('file activity outcomes compare-and-set', () => {
  it('rejects a later revision that reduces the same runtime turn epoch', async () => {
    await createStore().observe({ threadId, candidate: initial })
    const before = await readFile(path, 'utf8')
    current = { ...initial, revision: 5, turnEpoch: 1 }
    await expect(createStore().observe({ threadId, candidate: current })).rejects.toBeInstanceOf(
      FileActivityOutcomesUnavailableError,
    )
    expect(await readFile(path, 'utf8')).toBe(before)
  })

  it('revalidates duplicate observations but does not rewrite identical persisted facts', async () => {
    let validations = 0
    const validateCurrent = async () => {
      validations += 1
      return current
    }
    await createStore(validateCurrent).observe({ threadId, candidate: initial })
    await utimes(path, new Date('2000-01-01'), new Date('2000-01-01'))
    const before = await stat(path)
    current = { ...initial, working: true, awaiting: 'input' }
    expect(await createStore(validateCurrent).observe({ threadId, candidate: initial })).toEqual({
      snapshot: current,
      outcome: initial.observedOutcome,
    })
    expect(validations).toBe(2)
    const after = await stat(path)
    expect(after.mtimeMs).toBe(before.mtimeMs)
    expect(after.ino).toBe(before.ino)
  })

  it.each([
    { ...initial, turnEpoch: 3 },
    { ...initial, observedOutcome: null },
    {
      ...initial,
      observedOutcome: { identity: { kind: 'run', runId: 'another-run' }, outcome: 'completed' },
    },
  ] satisfies ReadActivityReply[])(
    'refuses equal-revision conflicting persisted facts: %j',
    async (conflict) => {
      await createStore().observe({ threadId, candidate: initial })
      const before = await readFile(path, 'utf8')
      current = conflict
      await expect(createStore().observe({ threadId, candidate: current })).rejects.toBeInstanceOf(
        FileActivityOutcomesUnavailableError,
      )
      expect(await readFile(path, 'utf8')).toBe(before)
    },
  )

  it('refuses a lower freshly validated revision through a reconstructed store without mutation', async () => {
    await createStore().observe({ threadId, candidate: initial })
    const before = await readFile(path, 'utf8')
    current = { ...initial, revision: 3 }
    await expect(createStore().observe({ threadId, candidate: current })).rejects.toBeInstanceOf(
      FileActivityOutcomesUnavailableError,
    )
    expect(await readFile(path, 'utf8')).toBe(before)
    expect(await createStore().read({ threadId })).toEqual(initial.observedOutcome)
  })
})
