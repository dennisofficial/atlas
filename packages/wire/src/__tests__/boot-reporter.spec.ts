import { describe, expect, it } from 'bun:test'

import {
  type BootStepEvent,
  createBootReporter,
  EBootStep,
  EBootStepState,
  MAX_BOOT_STEP_TEXT,
} from '../boot-progress-wire'

const event = (step: EBootStep, state: EBootStepState): BootStepEvent => ({ step, state })

type Gate = { promise: Promise<void>; open: () => void; fail: () => void }

const gate = (): Gate => {
  let open = () => {}
  let fail = () => {}
  const promise = new Promise<void>((resolve, reject) => {
    open = resolve
    fail = () => reject(new Error('sink down'))
  })
  return { promise, open, fail }
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('createBootReporter batching', () => {
  it('returns from report before the sink resolves', async () => {
    const blocker = gate()
    const reporter = createBootReporter({ sink: () => blocker.promise })
    await reporter.report(event(EBootStep.Provision, EBootStepState.Running))
    blocker.open()
    await reporter.flush()
  })

  it('delivers events in order', async () => {
    const batches: BootStepEvent[][] = []
    const reporter = createBootReporter({
      sink: async (events) => {
        batches.push([...events])
      },
    })
    await reporter.report(event(EBootStep.Provision, EBootStepState.Running))
    await reporter.report(event(EBootStep.Provision, EBootStepState.Done))
    await reporter.report(event(EBootStep.Serve, EBootStepState.Running))
    await reporter.flush()
    expect(batches.flat().map((e) => `${e.step}:${e.state}`)).toEqual([
      'provision:running',
      'provision:done',
      'serve:running',
    ])
  })

  it('sends reports made during an in-flight batch as one later batch', async () => {
    const blockers = [gate(), gate()]
    const batches: BootStepEvent[][] = []
    const reporter = createBootReporter({
      sink: (events) => {
        batches.push([...events])
        return (blockers[batches.length - 1] ?? gate()).promise
      },
    })
    await reporter.report(event(EBootStep.Provision, EBootStepState.Running))
    await tick()
    await reporter.report(event(EBootStep.Provision, EBootStepState.Done))
    await reporter.report(event(EBootStep.Serve, EBootStepState.Running))
    await tick()
    expect(batches).toHaveLength(1)
    blockers[0]?.open()
    await tick()
    expect(batches).toHaveLength(2)
    expect(batches[1]).toHaveLength(2)
    blockers[1]?.open()
    await reporter.flush()
  })

  it('chunks batches at 50 events', async () => {
    const sizes: number[] = []
    const reporter = createBootReporter({
      sink: async (events) => {
        sizes.push(events.length)
      },
    })
    for (let index = 0; index < 120; index += 1)
      await reporter.report(event(EBootStep.Clone, EBootStepState.Running))
    await reporter.flush()
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(120)
    expect(Math.max(...sizes)).toBeLessThanOrEqual(50)
  })

  it('logs a failed batch and still delivers later events', async () => {
    const logs: string[] = []
    const delivered: BootStepEvent[] = []
    let calls = 0
    const reporter = createBootReporter({
      log: (line) => logs.push(line),
      sink: async (events) => {
        calls += 1
        if (calls === 1) throw new Error('sink down')
        delivered.push(...events)
      },
    })
    await reporter.report(event(EBootStep.Provision, EBootStepState.Running))
    await reporter.flush()
    await reporter.report(event(EBootStep.Serve, EBootStepState.Running))
    await reporter.flush()
    expect(logs).toEqual(['boot step provision running was not reported: sink down'])
    expect(delivered.map((e) => e.step)).toEqual([EBootStep.Serve])
  })

  it('flush waits for in-flight and queued events', async () => {
    const blocker = gate()
    const delivered: BootStepEvent[] = []
    const reporter = createBootReporter({
      sink: async (events) => {
        await blocker.promise
        delivered.push(...events)
      },
    })
    await reporter.report(event(EBootStep.Provision, EBootStepState.Running))
    await reporter.report(event(EBootStep.Provision, EBootStepState.Done))
    let flushed = false
    const pending = reporter.flush().then(() => {
      flushed = true
    })
    await tick()
    expect(flushed).toBe(false)
    blocker.open()
    await pending
    expect(delivered).toHaveLength(2)
  })

  it('track does not await the running report and rethrows work errors after enqueuing Error', async () => {
    const blocker = gate()
    const delivered: BootStepEvent[] = []
    const reporter = createBootReporter({
      sink: async (events) => {
        await blocker.promise
        delivered.push(...events)
      },
    })
    const result = await reporter.track({ step: EBootStep.Clone, work: async () => 7 })
    expect(result).toBe(7)
    await expect(
      reporter.track({
        step: EBootStep.Context,
        work: async () => {
          throw new Error('boom')
        },
      }),
    ).rejects.toThrow('boom')
    blocker.open()
    await reporter.flush()
    expect(delivered.map((e) => `${e.step}:${e.state}`)).toEqual([
      'clone:running',
      'clone:done',
      'context:running',
      'context:error',
    ])
  })
})

describe('createBootReporter resilience', () => {
  it('truncates oversized error, detail and repo errors so one event cannot poison a batch', async () => {
    const batches: BootStepEvent[][] = []
    const reporter = createBootReporter({
      sink: async (events) => {
        batches.push([...events])
      },
    })
    const huge = 'x'.repeat(MAX_BOOT_STEP_TEXT * 3)
    await reporter.report({
      step: EBootStep.Clone,
      state: EBootStepState.Error,
      detail: huge,
      error: huge,
      repos: [{ repo: 'a/b', state: EBootStepState.Error, error: huge }],
    })
    await reporter
      .track({
        step: EBootStep.Context,
        work: async () => {
          throw new Error(huge)
        },
      })
      .catch(() => undefined)
    await reporter.flush()
    const [first, , errored] = batches.flat()
    expect(first?.detail).toHaveLength(MAX_BOOT_STEP_TEXT)
    expect(first?.error).toHaveLength(MAX_BOOT_STEP_TEXT)
    expect(first?.repos?.[0]?.error).toHaveLength(MAX_BOOT_STEP_TEXT)
    expect(errored?.error?.length).toBeLessThanOrEqual(MAX_BOOT_STEP_TEXT)
  })

  it('keeps delivering and lets flush resolve when the log callback throws', async () => {
    const delivered: BootStepEvent[] = []
    let calls = 0
    const reporter = createBootReporter({
      log: () => {
        throw new Error('log down')
      },
      sink: async (events) => {
        calls += 1
        if (calls === 1) throw new Error('sink down')
        delivered.push(...events)
      },
    })
    await reporter.report(event(EBootStep.Provision, EBootStepState.Running))
    await expect(reporter.flush()).resolves.toBeUndefined()
    await reporter.report(event(EBootStep.Serve, EBootStepState.Running))
    await expect(reporter.flush()).resolves.toBeUndefined()
    expect(delivered.map((e) => e.step)).toEqual([EBootStep.Serve])
  })
})
