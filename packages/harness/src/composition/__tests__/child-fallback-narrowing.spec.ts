import { describe, expect, it } from 'bun:test'

import { APICallError } from '@ai-sdk/provider'

import { ECredentialFailure } from '../../credentials/credential-error'
import { ModelStreamError } from '../../model/errors'
import { childFallbackModel } from '../child-fallback-model'
import {
  authFault,
  credentialFault,
  providerFault,
  quotaFault,
  REPLIED,
  StubModel,
  stepping,
} from './child-fallback-fixture'

describe('a child model whose fault is not a credential rejection', () => {
  it('switches on a hard quota rejection', async () => {
    const primary = new StubModel({ id: 'openrouter', modelId: 'kimi', fault: quotaFault() })
    const parent = new StubModel({ id: 'anthropic', modelId: 'claude-sonnet' })

    const port = childFallbackModel({ primary, parentFor: () => parent, onFallback: () => {} })

    await expect(stepping(port)).resolves.toBe(REPLIED)
    expect(parent.steps).toBe(1)
  })

  it.each([
    ['a bare 401 with no delivery provenance', providerFault({ status: 401 })],
    ['a generic 403', authFault(403)],
    ['a 404 model denial', authFault(404)],
    ['a malformed 400', providerFault({ status: 400 })],
    [
      'a missing authentication header',
      new APICallError({
        message: 'Missing Authentication header',
        url: 'https://provider.invalid',
        requestBodyValues: {},
        statusCode: 401,
        data: { error: { message: 'Missing Authentication header', code: 'invalid_api_key' } },
      }),
    ],
  ])('rethrows %s and never touches the parent', async (_name, fault) => {
    const primary = new StubModel({ id: 'openrouter', modelId: 'kimi', fault })
    const parent = new StubModel({ id: 'anthropic', modelId: 'claude-sonnet' })
    const switched: unknown[] = []

    const port = childFallbackModel({
      primary,
      parentFor: () => parent,
      onFallback: (caught) => switched.push(caught),
    })

    await expect(stepping(port)).rejects.toBe(fault)
    expect(parent.steps).toBe(0)
    expect(switched).toHaveLength(0)
    expect(port.identity).toEqual(primary.identity)
  })

  it('rethrows a caller abort rather than falling back', async () => {
    const abort = new DOMException('aborted', 'AbortError')
    const primary = new StubModel({ id: 'openrouter', modelId: 'kimi', fault: abort })
    const parent = new StubModel({ id: 'anthropic', modelId: 'claude-sonnet' })

    const port = childFallbackModel({ primary, parentFor: () => parent, onFallback: () => {} })

    await expect(stepping(port)).rejects.toBe(abort)
    expect(parent.steps).toBe(0)
  })

  describe('when the credential port fails before any request reaches the provider', () => {
    it.each([
      ECredentialFailure.NotFound,
      ECredentialFailure.Expired,
      ECredentialFailure.Unreadable,
      ECredentialFailure.Unsupported,
      ECredentialFailure.StoreUnavailable,
      ECredentialFailure.RefreshFailed,
    ])('surfaces a %s failure as itself without touching the parent', async (failure) => {
      const fault = credentialFault(failure)
      const primary = new StubModel({ id: 'openai', modelId: 'gpt', fault })
      const parent = new StubModel({ id: 'anthropic', modelId: 'claude-sonnet' })

      const port = childFallbackModel({ primary, parentFor: () => parent, onFallback: () => {} })

      await expect(stepping(port)).rejects.toBe(fault)
      expect(parent.steps).toBe(0)
    })

    it('surfaces a credential error wrapped in a stream error cause', async () => {
      const wrapped = new ModelStreamError({
        message: 'stream failed',
        cause: credentialFault(ECredentialFailure.NotFound),
      })
      const primary = new StubModel({ id: 'openai', modelId: 'gpt', fault: wrapped })
      const parent = new StubModel({ id: 'anthropic', modelId: 'claude-sonnet' })

      const port = childFallbackModel({ primary, parentFor: () => parent, onFallback: () => {} })

      await expect(stepping(port)).rejects.toBe(wrapped)
      expect(parent.steps).toBe(0)
    })
  })
})
