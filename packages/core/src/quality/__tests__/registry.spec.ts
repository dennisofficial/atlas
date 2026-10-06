import { describe, expect, it } from 'bun:test'

import { QualityContractError } from '../policy'
import { createQualityRegistry } from '../registry'
import { policyFixture } from './fixtures'

describe('createQualityRegistry', () => {
  it('rejects duplicate policy ids', () => {
    expect(() =>
      createQualityRegistry({
        policies: [policyFixture({ id: 'a', settingKey: 'k.a' }), policyFixture({ id: 'a', settingKey: 'k.b' })],
      }),
    ).toThrow(QualityContractError)
  })

  it('rejects duplicate setting keys', () => {
    expect(() =>
      createQualityRegistry({
        policies: [policyFixture({ id: 'a', settingKey: 'k' }), policyFixture({ id: 'b', settingKey: 'k' })],
      }),
    ).toThrow('duplicate quality policy settingKey "k"')
  })

  it('orders policies by id regardless of registration order', () => {
    const registry = createQualityRegistry({
      policies: [policyFixture({ id: 'c' }), policyFixture({ id: 'a' }), policyFixture({ id: 'b' })],
    })
    expect(registry.policies().map((policy) => policy.id)).toEqual(['a', 'b', 'c'])
    expect(registry.descriptors().map((descriptor) => descriptor.id)).toEqual(['a', 'b', 'c'])
  })

  it('projects descriptors without executable members', () => {
    const [descriptor] = createQualityRegistry({ policies: [policyFixture({ id: 'a' })] }).descriptors()
    expect(Object.keys(descriptor ?? {}).sort()).toEqual([
      'defaultEnabled',
      'description',
      'id',
      'settingKey',
      'title',
      'version',
    ])
  })

  it('looks up enabled policies by setting, falling back to the default', () => {
    const registry = createQualityRegistry({
      policies: [
        policyFixture({ id: 'a', settingKey: 'k.a', defaultEnabled: true }),
        policyFixture({ id: 'b', settingKey: 'k.b', defaultEnabled: false }),
        policyFixture({ id: 'c', settingKey: 'k.c', defaultEnabled: true }),
      ],
    })
    expect(registry.enabledIds({ settings: {} })).toEqual(['a', 'c'])
    expect(registry.enabledIds({ settings: { 'k.a': false, 'k.b': true } })).toEqual(['b', 'c'])
    expect(registry.get({ id: 'b' })?.id).toBe('b')
    expect(registry.get({ id: 'zzz' })).toBeUndefined()
  })

  it('accepts an empty registry', () => {
    expect(createQualityRegistry({ policies: [] }).enabled({ settings: {} })).toEqual([])
  })
})
