import { describe, expect, it } from 'bun:test'

import { APICallError } from '@ai-sdk/provider'
import {
  EFinishReason,
  ModelPort,
  type Assembled,
  type ModelStepResult,
  type ProviderIdentity,
} from '@dltech/atlas-core'

import { childFallbackModel } from '../child-fallback-model'

const ASSEMBLED = { messages: [], instructions: [], trace: [] } as unknown as Assembled

const REPLIED: ModelStepResult = {
  parts: [],
  toolCalls: [],
  finishReason: EFinishReason.Stop,
}

const authFault = (status: number): APICallError =>
  new APICallError({
    message: `the provider rejected the credential with ${status}`,
    url: 'https://provider.invalid/v1/messages',
    requestBodyValues: {},
    statusCode: status,
  })

class StubModel extends ModelPort {
  readonly identity: ProviderIdentity

  public steps = 0

  private readonly fault: unknown

  constructor(args: { id: string; modelId: string; fault?: unknown }) {
    super()
    this.identity = { id: args.id, modelId: args.modelId }
    this.fault = args.fault
  }

  async step(): Promise<ModelStepResult> {
    this.steps += 1
    if (this.fault !== undefined) throw this.fault
    return REPLIED
  }
}

const stepping = (model: ModelPort): Promise<ModelStepResult> =>
  model.step({ assembled: ASSEMBLED, tools: [], signal: new AbortController().signal })

describe('a child model that falls back to the session model', () => {
  it('switches straight to the parent on an auth fault, with no retry on the dead key', async () => {
    const primary = new StubModel({ id: 'openrouter', modelId: 'kimi', fault: authFault(401) })
    const parent = new StubModel({ id: 'anthropic', modelId: 'claude-sonnet' })
    const switched: unknown[] = []

    const port = childFallbackModel({
      primary,
      parentFor: () => parent,
      onFallback: (fault) => switched.push(fault),
    })

    const result = await stepping(port)

    expect(result).toBe(REPLIED)
    expect(primary.steps).toBe(1)
    expect(parent.steps).toBe(1)
    expect(switched).toHaveLength(1)
  })

  it('treats a 402 credit wall as an auth fault, since the account cannot pay either way', async () => {
    const primary = new StubModel({ id: 'openrouter', modelId: 'kimi', fault: authFault(402) })
    const parent = new StubModel({ id: 'anthropic', modelId: 'claude-sonnet' })

    const port = childFallbackModel({ primary, parentFor: () => parent, onFallback: () => {} })

    await expect(stepping(port)).resolves.toBe(REPLIED)
    expect(parent.steps).toBe(1)
  })

  it('rethrows a retryable fault so the retry loop owns it, never touching the parent', async () => {
    const primary = new StubModel({ id: 'openrouter', modelId: 'kimi', fault: authFault(429) })
    const parent = new StubModel({ id: 'anthropic', modelId: 'claude-sonnet' })

    const port = childFallbackModel({ primary, parentFor: () => parent, onFallback: () => {} })

    await expect(stepping(port)).rejects.toThrow()
    expect(parent.steps).toBe(0)
  })

  it('fails plainly when the child already runs the parent model, since there is nowhere to fall to', async () => {
    const primary = new StubModel({ id: 'anthropic', modelId: 'claude-sonnet', fault: authFault(401) })

    const port = childFallbackModel({ primary, parentFor: () => undefined, onFallback: () => {} })

    await expect(stepping(port)).rejects.toThrow()
  })

  it('surfaces the parent model s fault when the fallback also fails', async () => {
    const primary = new StubModel({ id: 'openrouter', modelId: 'kimi', fault: authFault(401) })
    const parent = new StubModel({ id: 'anthropic', modelId: 'claude-sonnet', fault: authFault(500) })

    const port = childFallbackModel({ primary, parentFor: () => parent, onFallback: () => {} })

    const thrown = await stepping(port).catch((error: unknown) => error)
    expect(APICallError.isInstance(thrown)).toBe(true)
    expect((thrown as APICallError).statusCode).toBe(500)
  })

  it('keeps the parent model once switched, rather than retrying the dead credential next step', async () => {
    const primary = new StubModel({ id: 'openrouter', modelId: 'kimi', fault: authFault(401) })
    const parent = new StubModel({ id: 'anthropic', modelId: 'claude-sonnet' })

    const port = childFallbackModel({ primary, parentFor: () => parent, onFallback: () => {} })

    await stepping(port)
    await stepping(port)

    expect(primary.steps).toBe(1)
    expect(parent.steps).toBe(2)
  })

  it('reads the parent model lazily, so a mid-session switch is followed on the next step', async () => {
    const primary = new StubModel({ id: 'openrouter', modelId: 'kimi', fault: authFault(401) })
    const first = new StubModel({ id: 'anthropic', modelId: 'claude-sonnet' })
    const second = new StubModel({ id: 'anthropic', modelId: 'claude-opus' })
    let current = first

    const port = childFallbackModel({ primary, parentFor: () => current, onFallback: () => {} })

    await stepping(port)
    current = second
    await stepping(port)

    expect(first.steps).toBe(1)
    expect(second.steps).toBe(1)
  })

  it('reports the model actually answering once it has switched', async () => {
    const primary = new StubModel({ id: 'openrouter', modelId: 'kimi', fault: authFault(401) })
    const parent = new StubModel({ id: 'anthropic', modelId: 'claude-sonnet' })

    const port = childFallbackModel({ primary, parentFor: () => parent, onFallback: () => {} })

    expect(port.identity).toEqual(primary.identity)
    await stepping(port)
    expect(port.identity).toEqual(parent.identity)
  })

  it('passes a clean primary straight through, identity and all', async () => {
    const primary = new StubModel({ id: 'openrouter', modelId: 'kimi' })
    const parent = new StubModel({ id: 'anthropic', modelId: 'claude-sonnet' })

    const port = childFallbackModel({ primary, parentFor: () => parent, onFallback: () => {} })

    expect(await stepping(port)).toBe(REPLIED)
    expect(parent.steps).toBe(0)
    expect(port.identity).toEqual(primary.identity)
  })

  describe('when the retry loop gives up on a retryable fault', () => {
    it('switches to the parent when the loop calls switch, so the next attempt answers from it', async () => {
      const primary = new StubModel({ id: 'openrouter', modelId: 'kimi', fault: authFault(529) })
      const parent = new StubModel({ id: 'anthropic', modelId: 'claude-sonnet' })
      const switched: unknown[] = []

      const port = childFallbackModel({
        primary,
        parentFor: () => parent,
        onFallback: (fault) => switched.push(fault),
      })

      expect(port.switch()).toBe(true)
      expect(port.identity).toEqual(parent.identity)
      expect(await stepping(port)).toBe(REPLIED)
      expect(parent.steps).toBe(1)
    })

    it('refuses to switch when the child already runs the parent model', () => {
      const primary = new StubModel({ id: 'anthropic', modelId: 'claude-sonnet' })

      const port = childFallbackModel({ primary, parentFor: () => undefined, onFallback: () => {} })

      expect(port.switch()).toBe(false)
      expect(port.identity).toEqual(primary.identity)
    })

    it('refuses a second switch once it has fallen back, since there is nowhere left to go', () => {
      const primary = new StubModel({ id: 'openrouter', modelId: 'kimi' })
      const parent = new StubModel({ id: 'anthropic', modelId: 'claude-sonnet' })

      const port = childFallbackModel({ primary, parentFor: () => parent, onFallback: () => {} })

      expect(port.switch()).toBe(true)
      expect(port.switch()).toBe(false)
    })
  })
})
