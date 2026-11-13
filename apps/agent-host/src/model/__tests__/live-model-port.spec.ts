import { describe, expect, it } from 'bun:test'

import type { LanguageModelV4StreamPart } from '@ai-sdk/provider'
import { MockLanguageModelV4 } from 'ai/test'
import {
  EAuthKind,
  EEffort,
  EImageTier,
  toEventId,
  type Assembled,
  type ModelCard,
  type ModelStepResult,
} from '@dltech/atlas-core'

import type { ModelConfig } from '../../config/agent-host-config'
import { AgentHostCredentialPort } from '../../config/agent-host-credential-port'
import type { IssuedModelToken } from '../../tokens/oauth-types'
import { AiSdkModelPort } from '../ai-sdk-model-port'
import { LiveModelPort } from '../live-model-port'

type Configured = Extract<ModelConfig, { configured: true }>

const configured = (over: Partial<Configured> = {}): Configured => ({
  configured: true,
  ref: { providerId: 'anthropic', modelId: 'claude-haiku-4-5' },
  effort: EEffort.Medium,
  fast: false,
  accountId: 'acct-1',
  credential: { kind: 'api-key', apiKey: 'sk-one' },
  ...over,
})

const labelOf = (config: ModelConfig): string =>
  config.configured === true ? config.accountId : 'none'

const oauthConfig = (accountId: string, connectionId: string): Configured =>
  configured({ accountId, credential: { kind: 'oauth', connectionId } })

const cardOf = (config: Configured): ModelCard => ({
  ref: config.ref,
  label: config.ref.modelId,
  api: 'anthropic-messages',
  contextWindow: config.ref.modelId === 'gpt-5' ? 400_000 : 200_000,
  imageTier: EImageTier.Standard,
})

const parts = (text: string): LanguageModelV4StreamPart[] => [
  { type: 'stream-start', warnings: [] },
  { type: 'text-start', id: 't' },
  { type: 'text-delta', id: 't', delta: text },
  { type: 'text-end', id: 't' },
  {
    type: 'finish',
    finishReason: { unified: 'stop', raw: 'stop' },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    },
  },
]

const streamOf = (text: string): ReadableStream<LanguageModelV4StreamPart> =>
  new ReadableStream({
    start(controller) {
      for (const part of parts(text)) controller.enqueue(part)
      controller.close()
    },
  })

const innerFor = (args: {
  config: ModelConfig
  answer: string
  builds: string[]
  onCall?: () => Promise<void>
}): AiSdkModelPort => {
  args.builds.push(args.answer)
  const config = args.config.configured === true ? args.config : configured()
  return new AiSdkModelPort({
    model: new MockLanguageModelV4({
      doStream: async () => {
        await args.onCall?.()
        return { stream: streamOf(args.answer) }
      },
    }),
    identity: { id: config.ref.providerId, modelId: config.ref.modelId },
    card: () => cardOf(config),
  })
}

const assembled: Assembled = {
  system: [],
  messages: [
    {
      message: { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      origin: { eventId: toEventId('e1'), seq: 1 },
    },
  ],
}

const stepArgs = { assembled, tools: [], signal: new AbortController().signal }

const textOf = (result: ModelStepResult): string =>
  result.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('')

describe('LiveModelPort', () => {
  it('keeps the port it built when the read config is unchanged', async () => {
    const builds: string[] = []
    const config = configured()
    const port = new LiveModelPort({
      initial: config,
      read: async () => ({ ...config, ref: { ...config.ref } }),
      build: (next) => innerFor({ config: next, answer: 'first', builds }),
    })
    expect(builds).toEqual(['first'])
    expect(textOf(await port.step(stepArgs))).toBe('first')
    expect(textOf(await port.step(stepArgs))).toBe('first')
    expect(builds).toEqual(['first'])
  })

  it('runs the next step on a port built for the switched account', async () => {
    const builds: string[] = []
    let current = configured({ accountId: 'acct-1' })
    const port = new LiveModelPort({
      initial: current,
      read: async () => current,
      build: (next) => innerFor({ config: next, answer: labelOf(next), builds }),
    })
    expect(textOf(await port.step(stepArgs))).toBe('acct-1')
    current = configured({ accountId: 'acct-2' })
    expect(textOf(await port.step(stepArgs))).toBe('acct-2')
    expect(builds).toEqual(['acct-1', 'acct-2'])
  })

  it('follows a ref change in identity and traits', async () => {
    const builds: string[] = []
    let current: ModelConfig = configured()
    const port = new LiveModelPort({
      initial: current,
      read: async () => current,
      build: (next) =>
        innerFor({
          config: next,
          answer: next.configured === true ? next.ref.modelId : 'none',
          builds,
        }),
    })
    expect(port.identity).toEqual({ id: 'anthropic', modelId: 'claude-haiku-4-5' })
    expect(port.traits().contextWindow).toBe(200_000)
    current = configured({ ref: { providerId: 'openai', modelId: 'gpt-5' }, effort: EEffort.High })
    expect(textOf(await port.step(stepArgs))).toBe('gpt-5')
    expect(port.identity).toEqual({ id: 'openai', modelId: 'gpt-5' })
    expect(port.traits().contextWindow).toBe(400_000)
  })

  it('keeps the current port and reports a failed read instead of failing the step', async () => {
    const builds: string[] = []
    const failures: unknown[] = []
    const port = new LiveModelPort({
      initial: configured(),
      read: async () => {
        throw new Error('database is restarting')
      },
      build: (next) => innerFor({ config: next, answer: 'kept', builds }),
      onReadFailure: (error) => failures.push(error),
    })
    expect(textOf(await port.step(stepArgs))).toBe('kept')
    expect(builds).toEqual(['kept'])
    expect(failures).toHaveLength(1)
    expect(failures[0]).toBeInstanceOf(Error)
  })

  it('reports a failed read even without a failure handler', async () => {
    const port = new LiveModelPort({
      initial: configured(),
      read: async () => {
        throw new Error('database is restarting')
      },
      build: (next) => innerFor({ config: next, answer: 'kept', builds: [] }),
    })
    expect(textOf(await port.step(stepArgs))).toBe('kept')
  })

  it('issues a token for the new connection after an account switch', async () => {
    const issued: string[] = []
    const answers: string[] = []
    const token = (connectionId: string): IssuedModelToken => ({
      accessToken: `token-${connectionId}`,
      expiresAt: '2099-01-01T00:00:00.000Z',
      refreshAfter: '2099-01-01T00:00:00.000Z',
      generation: 1,
    })
    const tokens = {
      issue: async (input: { userId: string; connectionId: string }): Promise<IssuedModelToken> => {
        issued.push(input.connectionId)
        return token(input.connectionId)
      },
    }
    const build = (config: ModelConfig): AiSdkModelPort => {
      const credentials = new AgentHostCredentialPort({ userId: 'user-1', model: config, tokens })
      return innerFor({
        config: config.configured === true ? config : configured(),
        answer: 'ok',
        builds: [],
        onCall: async () => {
          const credential = await credentials.read()
          answers.push(credential.kind === EAuthKind.Oauth ? credential.accessToken : 'api-key')
        },
      })
    }
    let current: ModelConfig = oauthConfig('acct-1', 'conn-1')
    const port = new LiveModelPort({ initial: current, read: async () => current, build })
    await port.step(stepArgs)
    expect(answers).toEqual(['token-conn-1'])
    current = oauthConfig('acct-2', 'conn-2')
    await port.step(stepArgs)
    expect(issued).toEqual(['conn-1', 'conn-2'])
    expect(answers).toEqual(['token-conn-1', 'token-conn-2'])
  })
})
