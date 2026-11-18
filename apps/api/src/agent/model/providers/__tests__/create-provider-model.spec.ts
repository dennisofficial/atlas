import { describe, expect, it } from 'bun:test'

import { EEffort } from '@dltech/atlas-core'

import { createProviderModel, UnsupportedProviderError } from '..'
import { FakeCredentials } from './provider-fixtures'

describe('createProviderModel', () => {
  it('throws for a provider it has no wiring for', () => {
    expect(() =>
      createProviderModel({
        ref: { providerId: 'mystery', modelId: 'm' },
        credentials: new FakeCredentials([]),
        effort: () => EEffort.Medium,
      }),
    ).toThrow(UnsupportedProviderError)
  })

  it('builds a model for a ref with no catalogue card without reading a credential', () => {
    const credentials = new FakeCredentials([])
    const model = createProviderModel({
      ref: { providerId: 'openrouter', modelId: 'nobody/knows-this' },
      credentials,
      effort: () => EEffort.Medium,
    })
    expect(model.modelId).toBe('nobody/knows-this')
    expect(credentials.reads).toHaveLength(0)
  })
})
