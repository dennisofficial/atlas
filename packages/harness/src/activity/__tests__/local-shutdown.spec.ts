import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { toThreadId } from '@dltech/atlas-core'
import type { ReadActivityReply } from '@dltech/atlas-wire'
import { createFileActivityOutcomes } from '../file-outcomes'
import { createCurrentActivityValidator } from '../local-inspection'
import { createLocalActivityObserver } from '../local-observer'

const threadId = toThreadId('root')
const snapshot: ReadActivityReply = {
  runtimeId: 'runtime',
  revision: 1,
  turnEpoch: 1,
  working: false,
  awaiting: null,
  observedOutcome: { identity: { kind: 'run', runId: 'run' }, outcome: 'completed' },
}

test('awaited shutdown drains a discarded observation, fresh validation, copy writes and the real file lock before restart', async () => {
  const home = await mkdtemp(join(tmpdir(), 'atlas-activity-shutdown-'))
  const path = join(home, 'root.activity.json')
  const freshRead = Promise.withResolvers<ReadActivityReply>()
  const validationEntered = Promise.withResolvers<void>()
  const copySettled = Promise.withResolvers<void>()
  let disconnectMain: () => void = () => undefined
  let freshClosed = false
  const inspector = {
    inspect: async () => ({
      state: 'running' as const,
      endpoint: { url: 'http://127.0.0.1:4000' },
    }),
  }
  const validator = createCurrentActivityValidator({
    inspector,
    open: () => ({
      read: () => {
        validationEntered.resolve()
        return freshRead.promise
      },
      settled: async () => undefined,
      close: () => {
        freshClosed = true
      },
    }),
  })
  const seed = createFileActivityOutcomes({
    pathFor: async () => path,
    validateCurrent: async () => snapshot,
  })
  await seed.observe({ threadId, candidate: snapshot })
  const outcomes = createFileActivityOutcomes({
    pathFor: async () => path,
    validateCurrent: validator,
  })
  const observer = createLocalActivityObserver({
    known: async () => true,
    inspector,
    outcomes,
    open: (args) => {
      disconnectMain = args.disconnect
      return {
        read: async () => snapshot,
        settled: async () => undefined,
        close: () => copySettled.promise,
      }
    },
  })
  const reading = observer.read({ threadId, lastAssistantSeq: 1, readSeq: null })
  let observerClosing: void | Promise<void>
  let validatorClosing: void | Promise<void>
  try {
    await validationEntered.promise
    expect(await readFile(`${path}.lock`, 'utf8')).toContain('token')
    disconnectMain()
    observerClosing = observer.close()
    validatorClosing = validator.close()
    expect(observerClosing).toBeInstanceOf(Promise)
    expect(validatorClosing).toBeInstanceOf(Promise)
    expect(freshClosed).toBe(true)
    let drained = false
    void Promise.resolve(observerClosing).then(() => {
      drained = true
    })
    freshRead.reject(new Error('fresh channel closed'))
    await validatorClosing
    await reading
    expect(drained).toBe(false)
    copySettled.resolve()
    await observerClosing
    await expect(readFile(`${path}.lock`)).rejects.toMatchObject({ code: 'ENOENT' })
    const recreated = createLocalActivityObserver({
      known: async () => true,
      inspector: { inspect: async () => ({ state: 'not-running' }) },
      outcomes: createFileActivityOutcomes({
        pathFor: async () => path,
        validateCurrent: async () => snapshot,
      }),
      open: () => {
        throw new Error('Stopped must not attach')
      },
    })
    expect(await recreated.read({ threadId, lastAssistantSeq: 1, readSeq: null })).toMatchObject({
      status: { lastOutcome: 'completed' },
    })
    await recreated.close()
  } finally {
    freshRead.reject(new Error('test cleanup'))
    copySettled.resolve()
    await Promise.allSettled([reading, observer.close(), validator.close()])
    await rm(home, { recursive: true, force: true })
  }
})
