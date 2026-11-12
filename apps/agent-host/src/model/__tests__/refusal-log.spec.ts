import { describe, expect, it } from 'bun:test'

import { ModelStreamError } from '@dltech/atlas-agent'
import { APICallError } from '@ai-sdk/provider'
import type { ProviderPrompt, ToolDeclaration } from '@dltech/atlas-core'

import { ELogSeverity, LogPort, type LogEntry } from '@dltech/atlas-observability'

import { logProviderRefusal, providerRefusalOf } from '../refusal-log'

class RecordingLog extends LogPort {
  readonly entries: LogEntry[] = []

  record(entry: LogEntry): void {
    this.entries.push(entry)
  }
}

const refusalOf = (args: { status: number; type?: string }) =>
  new APICallError({
    message: 'Third-party apps now draw from your extra usage, not your plan limits.',
    url: 'https://api.anthropic.com/v1/messages',
    requestBodyValues: { model: 'claude-opus-5-5' },
    statusCode: args.status,
    isRetryable: false,
    ...(args.type === undefined ? {} : { data: { type: 'error', error: { type: args.type } } }),
  })

const prompt: ProviderPrompt = {
  provider: { id: 'anthropic', modelId: 'claude-opus-5-5' },
  instructions: [{ text: 'a system block' }],
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
}

const toolOf = (name: string): ToolDeclaration =>
  ({ name, description: `${name} does a thing`, effect: 'read' }) as ToolDeclaration

describe('a refused provider call', () => {
  it('records the status, the provider type and the request sizes', () => {
    const refusal = providerRefusalOf({
      error: new ModelStreamError({
        message: 'wrapped',
        cause: refusalOf({ status: 400, type: 'invalid_request_error' }),
      }),
      prompt,
      tools: [toolOf('read'), toolOf('server_sign_in')],
    })

    expect(refusal?.status).toBe(400)
    expect(refusal?.modelId).toBe('claude-opus-5-5')
    expect(refusal?.providerType).toBe('invalid_request_error')
    expect(refusal?.providerMessage).toContain('Third-party apps')
    expect(refusal?.systemBytes).toBeGreaterThan(0)
    expect(refusal?.messageBytes).toBeGreaterThan(0)
    expect(refusal?.toolBytes).toBeGreaterThan(0)
    expect(refusal?.toolNames).toEqual(['read', 'server_sign_in'])
  })

  it('records every client error, including the one that is a rate limit', () => {
    expect(
      providerRefusalOf({ error: refusalOf({ status: 429 }), prompt, tools: [] })?.status,
    ).toBe(429)
  })

  it('stays quiet for a server error, which is not the request worded wrong', () => {
    for (const status of [500, 503]) {
      expect(providerRefusalOf({ error: refusalOf({ status }), prompt, tools: [] })).toBeUndefined()
    }
  })

  it('stays quiet for a failure that never reached the provider', () => {
    expect(providerRefusalOf({ error: new Error('no network'), prompt, tools: [] })).toBeUndefined()
  })
})

describe('recording a refused provider call', () => {
  it('writes one model entry carrying the status and the tool names', () => {
    const log = new RecordingLog()
    logProviderRefusal({
      log,
      error: refusalOf({ status: 400, type: 'invalid_request_error' }),
      prompt,
      tools: [toolOf('server_sign_in')],
    })

    expect(log.entries).toHaveLength(1)
    expect(log.entries[0]?.severity).toBe(ELogSeverity.Warn)
    expect(log.entries[0]?.source).toBe('model')
    expect(log.entries[0]?.message).toContain('400')
    expect(log.entries[0]?.data?.toolNames).toEqual(['server_sign_in'])
    expect(log.entries[0]?.data?.status).toBe(400)
  })

  it('writes nothing when there is no log', () => {
    expect(() =>
      logProviderRefusal({ log: undefined, error: refusalOf({ status: 400 }), prompt, tools: [] }),
    ).not.toThrow()
  })
})
