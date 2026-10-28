import { describe, expect, it } from 'bun:test'

import { EPluginRefusal } from '../validate'
import { validatePluginContribution } from '../validate-contribution'

describe('a contributed subscription provider is checked before the registry starts it', () => {
  const provider = {
    kind: 'github.pull-request',
    summary: 'a pull request',
    targetHint: 'owner/repo#1',
    resolve: () => undefined,
    start: () => undefined,
  }

  it('accepts a provider with a kind, resolve and start', () => {
    expect(
      validatePluginContribution({
        contribution: { subscriptionProviders: [provider] },
        pluginId: 'p',
      }).ok,
    ).toBe(true)
  })

  it('refuses providers that are not an array', () => {
    const checked = validatePluginContribution({
      contribution: { subscriptionProviders: {} },
      pluginId: 'p',
    })

    expect(checked.ok === false && checked.refusal).toBe(
      EPluginRefusal.SubscriptionProvidersNotAnArray,
    )
  })

  it('refuses a provider without a kind', () => {
    const checked = validatePluginContribution({
      contribution: { subscriptionProviders: [{ ...provider, kind: '' }] },
      pluginId: 'p',
    })

    expect(checked.ok === false && checked.refusal).toBe(
      EPluginRefusal.SubscriptionProviderMalformed,
    )
  })

  it('names the member that is not a function', () => {
    const checked = validatePluginContribution({
      contribution: { subscriptionProviders: [{ ...provider, resolve: 'nope' }] },
      pluginId: 'p',
    })

    expect(checked.ok === false && checked.refusal).toBe(
      EPluginRefusal.SubscriptionProviderMalformed,
    )
    expect(checked.ok === false && checked.detail).toContain('resolve')
  })
})
