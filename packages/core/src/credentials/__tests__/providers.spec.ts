import { describe, expect, it } from 'bun:test'

import { EAuthProvider } from '../account'
import { ELoginFlow, providerSpec } from '../providers'

describe('providerSpec', () => {
  it('prefers the browser login for OpenAI and keeps the device code as a fallback', () => {
    expect(providerSpec(EAuthProvider.OpenAI).logins).toEqual([
      ELoginFlow.BrowserCode,
      ELoginFlow.DeviceCode,
      ELoginFlow.ApiKey,
    ])
  })

  it('keeps every provider on the flows its label gates on', () => {
    for (const provider of Object.values(EAuthProvider)) {
      expect(providerSpec(provider).logins.length).toBeGreaterThan(0)
    }
  })
})
