import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toThreadId } from '@dltech/atlas-core'
import type { ReadActivityReply } from '@dltech/atlas-wire'

import { createFileActivityOutcomes, FileActivityOutcomesUnavailableError } from '../file-outcomes'

const threadId = toThreadId('thread')
const older: ReadActivityReply = {
  runtimeId: 'runtime',
  revision: 4,
  turnEpoch: 1,
  working: false,
  awaiting: null,
  observedOutcome: { identity: { kind: 'run', runId: 'old-run' }, outcome: 'completed' },
}
const newer: ReadActivityReply = {
  ...older,
  revision: 6,
  turnEpoch: 2,
  observedOutcome: { identity: { kind: 'run', runId: 'new-run' }, outcome: 'failed' },
}
let directory: string
let path: string
const children: Bun.Subprocess<'pipe', 'pipe', 'pipe'>[] = []
const createStore = (validateCurrent: () => Promise<ReadActivityReply>) =>
  createFileActivityOutcomes({
    pathFor: async () => path,
    validateCurrent,
  })

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'atlas-file-outcomes-concurrent-'))
  path = join(directory, 'thread.activity.json')
})

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) child.kill()
    await child.exited
  }
  await readdir(directory)
  await rm(directory, { recursive: true, force: true })
})

describe('file activity outcome concurrency', () => {
  it('serializes validation and fresh persisted reads across independent store instances', async () => {
    const entered = Promise.withResolvers<void>()
    const finish = Promise.withResolvers<void>()
    let laterValidations = 0
    const first = createStore(async () => {
      entered.resolve()
      await finish.promise
      return newer
    }).observe({ threadId, candidate: newer })
    await entered.promise
    const second = createStore(async () => {
      laterValidations += 1
      return older
    }).observe({ threadId, candidate: older })
    const results = Promise.allSettled([first, second])
    try {
      await Bun.sleep(20)
      expect(laterValidations).toBe(0)
    } finally {
      finish.resolve()
    }
    expect((await results).map((result) => result.status)).toEqual(['fulfilled', 'rejected'])
    expect(laterValidations).toBe(1)
    expect(await createStore(async () => older).read({ threadId })).toEqual(newer.observedOutcome)
  })

  it('rereads disk after a separate process commits rather than overwriting it with an older revision', async () => {
    const source = `
      import { createFileActivityOutcomes } from ${JSON.stringify(new URL('../file-outcomes.ts', import.meta.url).href)}
      const snapshot = ${JSON.stringify(newer)}
      const store = createFileActivityOutcomes({
        pathFor: async () => ${JSON.stringify(path)},
        validateCurrent: async () => {
          console.log('validating')
          await Bun.stdin.text()
          return snapshot
        },
      })
      await store.observe({ threadId: ${JSON.stringify(threadId)}, candidate: snapshot })
    `
    const child = Bun.spawn({
      cmd: [process.execPath, '--eval', source],
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    })
    children.push(child)
    const reader = child.stdout.getReader()
    const ready = await reader.read()
    reader.releaseLock()
    expect(new TextDecoder().decode(ready.value)).toBe('validating\n')
    expect(await readFile(`${path}.lock`, 'utf8')).toContain('token')
    const release = setTimeout(() => child.stdin.end(), 50)
    try {
      await expect(
        createStore(async () => older).observe({ threadId, candidate: older }),
      ).rejects.toBeInstanceOf(FileActivityOutcomesUnavailableError)
    } finally {
      clearTimeout(release)
    }
    expect(await child.exited).toBe(0)
    expect(await new Response(child.stderr).text()).toBe('')
    expect(await createStore(async () => older).read({ threadId })).toEqual(newer.observedOutcome)
    expect(await readdir(directory)).toEqual(['thread.activity.json'])
  })
})
