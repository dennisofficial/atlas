import { describe, expect, it } from 'bun:test'

import { APICallError } from '@ai-sdk/provider'
import {
  ERetryReason,
  ModelPort,
  type Assembled,
  type ModelStepResult,
  type ProviderIdentity,
  type RetryPolicy,
} from '@dltech/atlas-core'

import { ModelStreamError } from '../../model/errors'
import {
  sleepUnlessAborted,
  takeModelStepWithRetry,
  type ClockJumpDetector,
  type RetryNotice,
} from '../retrying-step'

const POLICY: RetryPolicy = { maxAttempts: 4, baseDelayMs: 1_000, maxDelayMs: 10_000 }

const ASSEMBLED = { messages: [], instructions: [], trace: [] } as unknown as Assembled

const REPLIED: ModelStepResult = {
  text: 'done',
  reasoning: [],
  toolCalls: [],
  finishReason: 'stop',
} as unknown as ModelStepResult

const overloaded = (): ModelStreamError =>
  new ModelStreamError({
    message: 'overloaded',
    cause: new APICallError({
      message: 'overloaded',
      url: 'https://api.anthropic.com/v1/messages',
      requestBodyValues: {},
      statusCode: 529,
    }),
  })

class ScriptedModel extends ModelPort {
  public steps = 0
  readonly identity = { vendor: 'anthropic', modelId: 'claude-test' } as unknown as ProviderIdentity

  constructor(private readonly outcomes: readonly ('fail' | 'ok')[]) {
    super()
  }

  async step(): Promise<ModelStepResult> {
    const outcome = this.outcomes[this.steps] ?? 'ok'
    this.steps += 1
    if (outcome === 'fail') throw overloaded()
    return REPLIED
  }
}

type RetryLogEntry = { attempt: number; maxAttempts: number; reason: string; willRetry: boolean; error: unknown }

function harness(args: { outcomes: readonly ('fail' | 'ok')[]; policy?: RetryPolicy }) {
  const model = new ScriptedModel(args.outcomes)
  const notices: RetryNotice[] = []
  const slept: number[] = []
  const logged: RetryLogEntry[] = []
  const controller = new AbortController()

  const run = () =>
    takeModelStepWithRetry({
      model,
      tools: [],
      onChunk: undefined,
      assembled: ASSEMBLED,
      signal: controller.signal,
      retry: {
        policy: args.policy ?? POLICY,
        onWaiting: (notice) => notices.push(notice),
        sleep: async ({ ms }) => void slept.push(ms),
        jitter: () => 1,
        log: (entry) => logged.push(entry),
      },
    })

  return { model, notices, slept, logged, controller, run }
}

describe('retrying a model step that failed for a reason worth retrying', () => {
  it('does not retry a step that worked', async () => {
    const { model, run, notices } = harness({ outcomes: ['ok'] })

    const stepped = await run()

    expect(stepped.ok).toBe(true)
    expect(model.steps).toBe(1)
    expect(notices).toEqual([])
  })

  it('comes back from a 529 and returns the reply', async () => {
    const { model, run } = harness({ outcomes: ['fail', 'ok'] })

    const stepped = await run()

    expect(stepped.ok).toBe(true)
    expect(model.steps).toBe(2)
  })

  it('waits longer each time it fails again', async () => {
    const { slept, run } = harness({ outcomes: ['fail', 'fail', 'ok'] })

    await run()

    expect(slept).toEqual([1_000, 2_000])
  })

  it('gives up once the attempts are spent, and reports the failure', async () => {
    const { model, run } = harness({ outcomes: ['fail', 'fail', 'fail', 'fail', 'fail'] })

    const stepped = await run()

    expect(stepped.ok).toBe(false)
    expect(model.steps).toBe(POLICY.maxAttempts)
  })

  it('logs each retry as will-retry and the give-up as not-retrying', async () => {
    const { logged, run } = harness({ outcomes: ['fail', 'fail', 'fail', 'fail', 'fail'] })

    await run()

    expect(logged).toHaveLength(POLICY.maxAttempts)
    expect(logged.slice(0, -1).every((entry) => entry.willRetry)).toBe(true)
    expect(logged.at(-1)?.willRetry).toBe(false)
    expect(logged[0]).toMatchObject({ attempt: 1, maxAttempts: POLICY.maxAttempts })
  })

  it('tells the operator which attempt is being waited on, and why', async () => {
    const { notices, run } = harness({ outcomes: ['fail', 'ok'] })

    await run()

    expect(notices).toEqual([
      { attempt: 1, maxAttempts: POLICY.maxAttempts, delayMs: 1_000, reason: ERetryReason.Overloaded },
    ])
  })

  it('does not retry a failure the request itself caused', async () => {
    const model = new ScriptedModel([])
    const controller = new AbortController()
    model.step = async () => {
      model.steps += 1
      throw new ModelStreamError({
        message: 'bad request',
        cause: new APICallError({
          message: 'bad request',
          url: 'https://api.anthropic.com/v1/messages',
          requestBodyValues: {},
          statusCode: 400,
        }),
      })
    }

    const stepped = await takeModelStepWithRetry({
      model,
      tools: [],
      onChunk: undefined,
      assembled: ASSEMBLED,
      signal: controller.signal,
      retry: { policy: POLICY, sleep: async () => {}, jitter: () => 1 },
    })

    expect(stepped.ok).toBe(false)
    expect(model.steps).toBe(1)
  })

  it('stops retrying the moment the operator interrupts', async () => {
    const model = new ScriptedModel(['fail', 'fail', 'fail'])
    const controller = new AbortController()
    const notices: RetryNotice[] = []

    const stepped = await takeModelStepWithRetry({
      model,
      tools: [],
      onChunk: undefined,
      assembled: ASSEMBLED,
      signal: controller.signal,
      retry: {
        policy: POLICY,
        onWaiting: (notice) => notices.push(notice),
        sleep: async () => void controller.abort(),
        jitter: () => 1,
      },
    })

    expect(stepped.ok).toBe(false)
    expect(model.steps).toBe(1)
    expect(notices.length).toBe(1)
  })
})

describe('retrying a prompt the provider rejected for length', () => {
  const sglangCapError = (): ModelStreamError =>
    new ModelStreamError({
      message: 'prompt is too long',
      cause: new APICallError({
        message:
          'Multimodal prompt is too long after expanding multimodal tokens with size 25000. len(req.origin_input_ids_unpadded)=250000 => 250000 >= 249994',
        url: 'https://api.inference.net/v1/chat/completions',
        requestBodyValues: {},
        statusCode: 400,
      }),
    })

  class LengthRejectingModel extends ModelPort {
    public steps = 0
    readonly identity = { vendor: 'inference', modelId: 'kimi-k3' } as unknown as ProviderIdentity

    constructor(private readonly rejections: number) {
      super()
    }

    async step(): Promise<ModelStepResult> {
      this.steps += 1
      if (this.steps <= this.rejections) throw sglangCapError()
      return REPLIED
    }
  }

  const run = (args: { model: LengthRejectingModel; policy?: RetryPolicy }) =>
    takeModelStepWithRetry({
      model: args.model,
      tools: [],
      onChunk: undefined,
      assembled: ASSEMBLED,
      signal: new AbortController().signal,
      retry: {
        ...(args.policy === undefined ? {} : { policy: args.policy }),
        sleep: async () => {},
        jitter: () => 1,
      },
    })

  it('gets one re-route for the identical payload when the policy budgets one', async () => {
    const model = new LengthRejectingModel(1)

    const stepped = await run({ model, policy: { ...POLICY, promptTooLongAttempts: 1 } })

    expect(stepped.ok).toBe(true)
    expect(model.steps).toBe(2)
  })

  it('does not keep re-routing past the one the budget allowed', async () => {
    const model = new LengthRejectingModel(3)

    const stepped = await run({ model, policy: { ...POLICY, promptTooLongAttempts: 1 } })

    expect(stepped.ok).toBe(false)
    expect(model.steps).toBe(2)
  })

  it('re-reads a policy resolution on every attempt, so a live toggle takes effect mid-run', async () => {
    const model = new LengthRejectingModel(5)

    let enabled = false
    const resolve = () => (enabled ? { ...POLICY, promptTooLongAttempts: 1 } : undefined)

    expect(
      (
        await takeModelStepWithRetry({
          model,
          tools: [],
          onChunk: undefined,
          assembled: ASSEMBLED,
          signal: new AbortController().signal,
          retry: { policy: resolve, sleep: async () => {}, jitter: () => 1 },
        })
      ).ok,
    ).toBe(false)
    expect(model.steps).toBe(1)

    enabled = true
    model.steps = 0
    expect(
      (
        await takeModelStepWithRetry({
          model,
          tools: [],
          onChunk: undefined,
          assembled: ASSEMBLED,
          signal: new AbortController().signal,
          retry: { policy: resolve, sleep: async () => {}, jitter: () => 1 },
        })
      ).ok,
    ).toBe(false)
    expect(model.steps).toBe(2)
  })

  it('never re-routes on an unbudgeted policy, matching behaviour with the workaround off', async () => {
    const model = new LengthRejectingModel(1)

    const stepped = await run({ model })

    expect(stepped.ok).toBe(false)
    expect(model.steps).toBe(1)
  })
})

/**
 * A request that fails before the stream opens throws rather than returning, because
 * `takeModelStep` only converts `ModelStreamError`. That is the shape a 429 or a refused
 * connection on the initial call arrives in, so it has to be retried too.
 */
describe('retrying a failure that was thrown rather than returned', () => {
  const rawApiError = (statusCode: number): APICallError =>
    new APICallError({
      message: `upstream said ${statusCode}`,
      url: 'https://api.anthropic.com/v1/messages',
      requestBodyValues: {},
      statusCode,
    })

  function throwing(args: { statuses: readonly number[]; policy?: RetryPolicy }) {
    const model = new ScriptedModel([])
    const controller = new AbortController()
    const notices: RetryNotice[] = []
    let calls = 0

    model.step = async () => {
      const status = args.statuses[calls]
      calls += 1
      if (status !== undefined) throw rawApiError(status)
      return REPLIED
    }

    const run = () =>
      takeModelStepWithRetry({
        model,
        tools: [],
        onChunk: undefined,
        assembled: ASSEMBLED,
        signal: controller.signal,
        retry: {
          policy: args.policy ?? POLICY,
          onWaiting: (notice) => notices.push(notice),
          sleep: async () => {},
          jitter: () => 1,
        },
      })

    return { run, notices, calls: () => calls }
  }

  it('retries a rate limit thrown by the initial request, and returns the reply', async () => {
    const { run, calls } = throwing({ statuses: [429] })

    const stepped = await run()

    expect(stepped.ok).toBe(true)
    expect(calls()).toBe(2)
  })

  it('counts the thrown attempt, so the operator sees it being waited on', async () => {
    const { run, notices } = throwing({ statuses: [429] })

    await run()

    expect(notices).toEqual([
      { attempt: 1, maxAttempts: POLICY.maxAttempts, delayMs: 1_000, reason: ERetryReason.RateLimited },
    ])
  })

  it('rethrows a thrown failure that is not worth retrying, rather than swallowing it', async () => {
    const { run, calls } = throwing({ statuses: [401] })

    await expect(run()).rejects.toThrow('upstream said 401')
    expect(calls()).toBe(1)
  })

  it('rethrows the original error once the retries are spent', async () => {
    const spent = Array.from({ length: POLICY.maxAttempts }, () => 529)
    const { run, calls } = throwing({ statuses: spent })

    await expect(run()).rejects.toThrow('upstream said 529')
    expect(calls()).toBe(POLICY.maxAttempts)
  })
})

class ScriptedClockJump implements ClockJumpDetector {
  private listener: ((gapMs: number) => void) | undefined

  onJump(callback: (gapMs: number) => void): () => void {
    this.listener = callback
    return () => {
      this.listener = undefined
    }
  }

  jump(gapMs: number = 300_000): void {
    this.listener?.(gapMs)
  }
}

describe('recovering the retry budget after the machine slept', () => {
  const failsPerBudget = POLICY.maxAttempts

  function waking(args: {
    outcomes: readonly ('fail' | 'ok')[]
    sleeps?: number
    jumpOnStep?: number
  }) {
    const model = new ScriptedModel(args.outcomes)
    const notices: RetryNotice[] = []
    const slept: number[] = []
    const clockJumps = new ScriptedClockJump()
    const controller = new AbortController()
    let sleeps = 0

    const run = () =>
      takeModelStepWithRetry({
        model,
        tools: [],
        onChunk: undefined,
        assembled: ASSEMBLED,
        signal: controller.signal,
        retry: {
          policy: POLICY,
          clockJumps,
          onWaiting: (notice) => notices.push(notice),
          sleep: async ({ ms, signal }) => {
            slept.push(ms)
            sleeps += 1
            if (sleeps !== (args.sleeps ?? Number.POSITIVE_INFINITY)) return
            clockJumps.jump()
            if (signal.aborted) return
            await sleepUnlessAborted({ ms: 60_000, signal })
          },
          jitter: () => 1,
        },
      })

    if (args.jumpOnStep !== undefined) {
      const step = model.step.bind(model)
      model.step = async () => {
        if (model.steps + 1 === args.jumpOnStep) clockJumps.jump()
        return step()
      }
    }

    return { model, notices, slept, clockJumps, run }
  }

  it('resets the attempt counter, so the wake attempt is 1/maxAttempts again', async () => {
    const outcomes = Array.from({ length: failsPerBudget + 1 }, () => 'fail' as const)
    const { model, notices, run } = waking({ outcomes, sleeps: 1 })

    const stepped = await run()

    expect(stepped.ok).toBe(false)
    expect(model.steps).toBe(failsPerBudget + 1)
    expect(notices.map((notice) => notice.attempt)).toEqual([
      1,
      1, 2, 3,
    ])
  })

  it('cuts the backoff sleep short on the jump instead of sitting out the delay', async () => {
    const { model, slept, run } = waking({ outcomes: ['fail', 'ok'], sleeps: 1 })

    const started = Date.now()
    const stepped = await run()

    expect(stepped.ok).toBe(true)
    expect(model.steps).toBe(2)
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(slept).toEqual([1_000])
  })

  it('holds when the jump fires mid-attempt rather than during the backoff', async () => {
    const outcomes = Array.from({ length: failsPerBudget + 1 }, () => 'fail' as const)
    const { model, notices, run } = waking({ outcomes, jumpOnStep: 2 })

    const stepped = await run()

    expect(stepped.ok).toBe(false)
    expect(model.steps).toBe(failsPerBudget + 1)
    expect(notices.map((notice) => notice.attempt)).toEqual([
      1,
      1, 2, 3,
    ])
  })

  it('cannot stack resets: one pending jump is spent once, so a wake loop runs out of budget', async () => {
    const outcomes = Array.from({ length: failsPerBudget + 1 }, () => 'fail' as const)
    const { model, notices, clockJumps, run } = waking({ outcomes, sleeps: 1 })
    const steppedPromise = run()
    clockJumps.jump()
    clockJumps.jump()

    const stepped = await steppedPromise

    expect(stepped.ok).toBe(false)
    expect(model.steps).toBe(failsPerBudget + 1)
    expect(notices.map((notice) => notice.attempt)).toEqual([
      1,
      1, 2, 3,
    ])
  })
})
