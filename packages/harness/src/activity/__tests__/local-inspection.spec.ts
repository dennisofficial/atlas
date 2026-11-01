import { expect, test } from 'bun:test'
import { toThreadId } from '@dltech/atlas-core'
import { ECloudSandboxState } from '../../cloud/cloud-bridge'
import {
  createCurrentActivityValidator,
  createLocalActivityInspector,
  type LocalActivityInspector,
} from '../local-inspection'

const threadId = toThreadId('root')
const snapshot = {
  runtimeId: 'runtime',
  revision: 1,
  turnEpoch: 0,
  working: false,
  awaiting: null,
  observedOutcome: null,
}

test('passive inspect distinguishes stopped, loopback Running and unavailable without leaking raw errors', async () => {
  for (const url of [
    undefined,
    'not-a-url',
    'http://remote.test:4000',
    'http://token@127.0.0.1:4000',
  ]) {
    const inspector = createLocalActivityInspector({
      find: async () => ({
        state: ECloudSandboxState.Running,
        ...(url === undefined ? {} : { url }),
      }),
    })
    expect((await inspector.inspect({ threadId })).state).toBe('unavailable')
  }
  expect(
    await createLocalActivityInspector({ find: async () => undefined }).inspect({ threadId }),
  ).toEqual({ state: 'not-running' })
  expect(
    await createLocalActivityInspector({
      find: async () => ({ state: ECloudSandboxState.Running, url: 'http://127.0.0.1:4000' }),
    }).inspect({ threadId }),
  ).toEqual({ state: 'running', endpoint: { url: 'http://127.0.0.1:4000' } })
  const failed = createLocalActivityInspector({
    find: async () => {
      throw new Error('raw-token')
    },
  })
  expect(await failed.inspect({ threadId })).toEqual({
    state: 'unavailable',
    reason: 'Activity inspection unavailable',
  })
})

test('current endpoint validation closes its fresh channel and rejects endpoint replacement during read', async () => {
  let inspections = 0
  let closed = 0
  const inspector: LocalActivityInspector = {
    inspect: async () => ({
      state: 'running',
      endpoint: { url: `http://127.0.0.1:${++inspections === 1 ? 4000 : 4001}` },
    }),
  }
  const validate = createCurrentActivityValidator({
    inspector,
    open: () => ({
      read: async () => snapshot,
      settled: async () => undefined,
      close: () => {
        closed += 1
      },
    }),
  })
  await expect(validate({ threadId })).rejects.toThrow('endpoint changed')
  expect(closed).toBe(1)
  validate.close()
})

test('closing current validation rejects in-flight proof and closes its fresh channel', async () => {
  let release: (value: typeof snapshot) => void = () => undefined
  let started: () => void = () => undefined
  const entered = new Promise<void>((resolve) => {
    started = resolve
  })
  let closed = 0
  const validate = createCurrentActivityValidator({
    inspector: {
      inspect: async () => ({ state: 'running', endpoint: { url: 'http://127.0.0.1:4000' } }),
    },
    open: () => ({
      read: () =>
        new Promise((resolve) => {
          release = resolve
          started()
        }),
      settled: async () => undefined,
      close: () => {
        closed += 1
      },
    }),
  })
  const pending = validate({ threadId })
  await entered
  validate.close()
  expect(closed).toBe(1)
  release(snapshot)
  await expect(pending).rejects.toThrow('endpoint changed')
  await expect(validate({ threadId })).rejects.toThrow('validator closed')
})

test('a hung passive find times out as unavailable and receives an abort signal', async () => {
  let seen: AbortSignal | undefined
  const inspector = createLocalActivityInspector({
    timeoutMs: 20,
    find: ({ signal }) => {
      seen = signal
      return new Promise(() => undefined)
    },
  })
  expect(await inspector.inspect({ threadId })).toEqual({
    state: 'unavailable',
    reason: 'Activity inspection unavailable',
  })
  expect(seen?.aborted).toBe(true)
})

test('an already-cancelled caller never reaches find and a signal-ignoring find still settles', async () => {
  let calls = 0
  const inspector = createLocalActivityInspector({
    timeoutMs: 1_000,
    find: () => {
      calls += 1
      return new Promise(() => undefined)
    },
  })
  const controller = new AbortController()
  const pending = inspector.inspect({ threadId, signal: controller.signal })
  controller.abort()
  expect((await pending).state).toBe('unavailable')
  expect(calls).toBe(1)
  expect((await inspector.inspect({ threadId, signal: controller.signal })).state).toBe(
    'unavailable',
  )
  expect(calls).toBe(1)
})

test('closing the validator cancels an in-flight passive inspection', async () => {
  let seen: AbortSignal | undefined
  const entered = Promise.withResolvers<void>()
  const inspector = createLocalActivityInspector({
    timeoutMs: 60_000,
    find: ({ signal }) => {
      seen = signal
      entered.resolve()
      return new Promise(() => undefined)
    },
  })
  const validate = createCurrentActivityValidator({
    inspector,
    open: () => {
      throw new Error('must not open')
    },
  })
  const pending = validate({ threadId })
  await entered.promise
  const closing = validate.close()
  await expect(pending).rejects.toThrow()
  await closing
  expect(seen?.aborted).toBe(true)
})
