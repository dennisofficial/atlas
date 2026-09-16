import { describe, expect, it } from 'bun:test'

import { createIsolatedContainer, portToken } from '../../container/injection'
import { LiveSkillRegistry } from '../live-registry'
import { ESkillOrigin } from '../skill'
import { SkillRegistryPort } from '../port'
import { registerSkills } from '../register-skills'

const registryIn = (sources?: Parameters<typeof registerSkills>[0]['sources']) => {
  const container = createIsolatedContainer()
  registerSkills({ container, sources })
  return container.resolve(portToken(SkillRegistryPort))
}

describe('registerSkills', () => {
  it('binds a registry the container can answer with, not a phantom', () => {
    const registry = registryIn()

    expect(registry).toBeInstanceOf(LiveSkillRegistry)
    expect(registry.all()).toEqual([])
    expect(registry.byName('commit')).toBeUndefined()
  })

  it('offers the built-ins once the bound registry is reloaded', async () => {
    const registry = registryIn()

    const loaded = await registry.reload()
    expect(loaded.map((skill) => skill.spec.name)).toEqual(expect.arrayContaining(['commit']))
    expect(loaded.every((skill) => skill.origin === ESkillOrigin.BuiltIn)).toBe(true)
    expect(registry.byName('commit')?.spec.name).toBe('commit')
  })

  it('hands every resolver the same instance so a reload is seen everywhere', async () => {
    const container = createIsolatedContainer()
    registerSkills({ container })

    const first = container.resolve(portToken(SkillRegistryPort))
    await first.reload()

    expect(container.resolve(portToken(SkillRegistryPort)).all()).toHaveLength(
      first.all().length,
    )
  })

  it('takes the sources a caller supplies over the built-in default', async () => {
    const registry = registryIn(() => [])

    expect(await registry.reload()).toEqual([])
  })
})
