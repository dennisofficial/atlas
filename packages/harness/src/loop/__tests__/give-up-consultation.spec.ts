import { describe, expect, it } from 'bun:test'

import { APICallError } from '@ai-sdk/provider'
import {
  ModelPort,
  toAccountId,
  type Assembled,
  type ModelStepResult,
  type ProviderIdentity,
  type RetryPolicy,
} from '@dltech/atlas-core'

import { CredentialError, ECredentialFailure } from '../../credentials/credential-error'
import { ModelStreamError } from '../../model/errors'
import { withFailureAccount } from '../../providers/failure-account'
import { takeModelStepWithRetry } from '../retrying-step'

const POLICY: RetryPolicy = { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1 }
const ASSEMBLED = { messages: [], instructions: [], trace: [] } as unknown as Assembled
const REPLIED = { parts: [], toolCalls: [], finishReason: 'stop' } as unknown as ModelStepResult

const apiFault = (args: { status: number; code?: string; delivered?: boolean }): ModelStreamError =>
  new ModelStreamError({
    message: `status ${args.status}`,
    cause: withFailureAccount({
      error: new APICallError({
        message: `status ${args.status}`,
        url: 'https://provider.test',
        requestBodyValues: {},
        statusCode: args.status,
        ...(args.code === undefined ? {} : { data: { error: { code: args.code } } }),
      }),
      accountId: toAccountId('acct-1'),
      authorizationDelivered: args.delivered ?? true,
    }),
  })

class AlwaysFailing extends ModelPort {
  readonly identity = { id: 'p', modelId: 'm' } as ProviderIdentity
  steps = 0
  constructor(private readonly fault: () => unknown) {
    super()
  }
  async step(): Promise<ModelStepResult> {
    this.steps += 1
    throw this.fault()
  }
}

async function run(args: { fault: () => unknown; giveUp: () => boolean }) {
  const model = new AlwaysFailing(args.fault)
  let consulted = 0
  const stepped = await takeModelStepWithRetry({
    model,
    tools: [],
    onChunk: undefined,
    assembled: ASSEMBLED,
    signal: new AbortController().signal,
    retry: {
      policy: POLICY,
      sleep: async () => {},
      jitter: () => 1,
      onGiveUp: () => {
        consulted += 1
        return args.giveUp()
      },
    },
  }).catch((thrown: unknown) => ({ ok: false as const, thrown }))
  return { model, consulted: () => consulted, stepped }
}

describe('consulting onGiveUp', () => {
  it.each([
    ['a hard quota 429', { status: 429, code: 'insufficient_quota' }],
    ['a rejected key', { status: 401, code: 'invalid_api_key' }],
  ])('consults once on %s, on the first rejected request', async (_name, fault) => {
    const { model, consulted } = await run({ fault: () => apiFault(fault), giveUp: () => false })

    expect(model.steps).toBe(1)
    expect(consulted()).toBe(1)
  })

  it('consults once when a transient fault spends the whole budget', async () => {
    const { model, consulted } = await run({
      fault: () => apiFault({ status: 529 }),
      giveUp: () => false,
    })

    expect(model.steps).toBe(POLICY.maxAttempts)
    expect(consulted()).toBe(1)
  })

  it.each([
    ['a 400', apiFault({ status: 400 })],
    ['a 404 model denial', apiFault({ status: 404 })],
    ['a generic 403', apiFault({ status: 403 })],
    ['an unproven 401', apiFault({ status: 401, delivered: false })],
    [
      'a missing credential',
      new CredentialError({ failure: ECredentialFailure.NotFound, message: 'x' }),
    ],
    ['an unclassifiable error', new TypeError('bug')],
  ])('never consults on %s', async (_name, fault) => {
    const { model, consulted } = await run({ fault: () => fault, giveUp: () => true })

    expect(model.steps).toBe(1)
    expect(consulted()).toBe(0)
  })

  it('cannot be consulted a second time when the callback always says yes', async () => {
    const { model, consulted, stepped } = await run({
      fault: () => apiFault({ status: 529 }),
      giveUp: () => true,
    })

    expect(stepped.ok).toBe(false)
    expect(consulted()).toBe(1)
    expect(model.steps).toBe(POLICY.maxAttempts * 2)
  })

  it('grants a hard quota rejection only one extra model', async () => {
    const { model, consulted } = await run({
      fault: () => apiFault({ status: 429, code: 'insufficient_quota' }),
      giveUp: () => true,
    })

    expect(consulted()).toBe(1)
    expect(model.steps).toBe(2)
  })

  it('lets the fresh budget succeed once the fallback answers', async () => {
    const model = new AlwaysFailing(() => apiFault({ status: 401, code: 'invalid_api_key' }))
    const stepped = await takeModelStepWithRetry({
      model,
      tools: [],
      onChunk: undefined,
      assembled: ASSEMBLED,
      signal: new AbortController().signal,
      retry: {
        policy: POLICY,
        sleep: async () => {},
        onGiveUp: () => {
          model.step = async () => REPLIED
          return true
        },
      },
    })

    expect(stepped.ok).toBe(true)
  })
})
