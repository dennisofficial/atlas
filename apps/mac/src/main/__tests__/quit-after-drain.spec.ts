import { describe, expect, test } from 'bun:test'
import { createQuitAfterDrain, type IQuitEvent } from '../quit-after-drain'

function deferred() {
  let resolve: () => void = () => {}
  let reject: (error: unknown) => void = () => {}
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function setup() {
  const pending = deferred()
  const calls = { stop: 0, quit: 0, errors: [] as unknown[] }
  let listener: (event: IQuitEvent) => void = () => {}
  const handler = createQuitAfterDrain({
    stop: () => {
      calls.stop += 1
      return pending.promise
    },
    quit: () => {
      calls.quit += 1
      listener({})
    },
    onError: (error) => void calls.errors.push(error),
  })
  listener = handler
  return { pending, calls, handler }
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('createQuitAfterDrain', () => {
  test('vetoes synchronously and does not quit before the stop settles', async () => {
    const { handler, calls } = setup()
    const event: IQuitEvent = {}
    handler(event)
    expect(event.response).toEqual({ allow: false })
    await settle()
    expect(calls.quit).toBe(0)
  })

  test('shares one stop across repeated quit requests and vetoes each', () => {
    const { handler, calls } = setup()
    const events: IQuitEvent[] = [{}, {}, {}]
    for (const event of events) handler(event)
    expect(calls.stop).toBe(1)
    expect(events.map((event) => event.response)).toEqual([
      { allow: false },
      { allow: false },
      { allow: false },
    ])
  })

  test('quits once after fulfillment and lets the re-entrant request pass', async () => {
    const { handler, calls, pending } = setup()
    handler({})
    pending.resolve()
    await settle()
    expect(calls.quit).toBe(1)
    expect(calls.stop).toBe(1)
    const reentry: IQuitEvent = {}
    handler(reentry)
    expect(reentry.response).toBeUndefined()
    expect(calls.stop).toBe(1)
  })

  test('lets the quit re-entry pass while quit is running', async () => {
    const pending = deferred()
    const reentries: IQuitEvent[] = []
    const handler = createQuitAfterDrain({
      stop: () => pending.promise,
      quit: () => {
        const reentry: IQuitEvent = {}
        handler(reentry)
        reentries.push(reentry)
      },
      onError: () => {},
    })
    handler({})
    pending.resolve()
    await settle()
    expect(reentries).toHaveLength(1)
    expect(reentries[0]?.response).toBeUndefined()
  })

  test('logs a rejected stop, never quits, and keeps vetoing', async () => {
    const { handler, calls, pending } = setup()
    const failure = new Error('close failed')
    handler({})
    pending.reject(failure)
    await settle()
    expect(calls.quit).toBe(0)
    expect(calls.errors).toEqual([failure])
    const later: IQuitEvent = {}
    handler(later)
    expect(later.response).toEqual({ allow: false })
    expect(calls.stop).toBe(1)
  })

  test('reports a synchronous stop throw and a failing quit without unhandled rejections', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => void unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    const errors: unknown[] = []
    const throwing = createQuitAfterDrain({
      stop: () => {
        throw new Error('sync')
      },
      quit: () => {},
      onError: (error) => void errors.push(error),
    })
    const failingQuit = createQuitAfterDrain({
      stop: () => Promise.resolve(),
      quit: () => Promise.reject(new Error('quit failed')),
      onError: (error) => void errors.push(error),
    })
    throwing({})
    failingQuit({})
    await settle()
    process.off('unhandledRejection', onUnhandled)
    expect(errors.map((error) => (error as Error).message)).toEqual(['sync', 'quit failed'])
    expect(unhandled).toEqual([])
  })
})
