import { describe, expect, it } from 'bun:test'

import { EDefinitionOrigin } from '../origin'
import { resolveShadowing } from '../shadowing'
import { skillRootPlan } from '../../skills/roots'

type Definition = { name: string; body: string; origin: EDefinitionOrigin }

const at = (args: { name: string; origin: EDefinitionOrigin }): Definition => ({
  name: args.name,
  body: `${args.origin} ${args.name}`,
  origin: args.origin,
})

describe('cloud skill precedence', () => {
  const planOrder = () =>
    skillRootPlan({
      atlasHome: '/home/dennis/.atlas',
      home: '/home/dennis',
      cwd: '/work/atlas',
      skillsDirectoryName: 'skills',
    })

  it('resolves repo > project-cloud > global > built-in for one skill name', () => {
    const definitions = planOrder().map((root) => ({
      name: 'commit',
      body: root.directory,
      origin: root.origin,
    }))

    const resolved = resolveShadowing({ definitions, nameOf: (definition) => definition.name })

    expect(resolved).toHaveLength(1)
    expect(resolved[0]?.body).toBe('/work/atlas/.atlas/skills')
  })

  it('lets the cloud project skill win over global and built-in when the repo stays silent', () => {
    const definitions = planOrder()
      .filter(
        (root) =>
          root.origin !== EDefinitionOrigin.Project ||
          root.directory === '/home/dennis/.atlas/project-skills',
      )
      .map((root) => ({ name: 'commit', body: root.directory, origin: root.origin }))
    definitions.push(at({ name: 'commit', origin: EDefinitionOrigin.BuiltIn }))

    const resolved = resolveShadowing({ definitions, nameOf: (definition) => definition.name })

    expect(resolved).toHaveLength(1)
    expect(resolved[0]?.body).toBe('/home/dennis/.atlas/project-skills')
  })

  it('lets the global skill shadow the built-in when no project source carries the name', () => {
    const definitions = [
      ...planOrder()
        .filter((root) => root.origin === EDefinitionOrigin.User)
        .map((root) => ({ name: 'commit', body: root.directory, origin: root.origin })),
      at({ name: 'commit', origin: EDefinitionOrigin.BuiltIn }),
    ]

    const resolved = resolveShadowing({ definitions, nameOf: (definition) => definition.name })

    expect(resolved).toHaveLength(1)
    expect(resolved[0]?.origin).toBe(EDefinitionOrigin.User)
  })
})
