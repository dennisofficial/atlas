import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { z } from 'zod'

import {
  ATLAS_HOME_ENV,
  DynamicToolSource,
  EExecutionLocation,
  EToolEffect,
  EWebSearchBackend,
  ToolDefinition,
  type ToolDeclaration,
} from '@dltech/atlas-core'

import {
  createExecutionLocationState,
  ExecutionLocationToken,
} from '../../composition/execution-location-state'
import { createHarnessContainer } from '../../container/create-harness-container'
import { disposeAll } from '../../container/disposal'
import {
  portToken,
  registeredPortToken,
  resolveSet,
  type DependencyContainer,
} from '../../container/injection'
import {
  WebSearchBackendToken,
  WorktreeDirectoryToken,
  WorkspaceRoot,
} from '../../container/tokens'
import { ToolRegistry } from '../registry'

const BASE_CLASS_SLOTS = new Set(['claimsDeeds'])

const opened: DependencyContainer[] = []
let home = ''
let root = ''
const previousHome = process.env[ATLAS_HOME_ENV]

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'atlas-register-tools-home-'))
  root = mkdtempSync(join(tmpdir(), 'atlas-register-tools-root-'))
  process.env[ATLAS_HOME_ENV] = home
})

afterAll(async () => {
  for (const container of opened.splice(0)) await disposeAll({ container })
  if (previousHome === undefined) delete process.env[ATLAS_HOME_ENV]
  else process.env[ATLAS_HOME_ENV] = previousHome
  rmSync(home, { recursive: true, force: true })
  rmSync(root, { recursive: true, force: true })
})

function rooted(): DependencyContainer {
  const container = createHarnessContainer()
  container.register(WorkspaceRoot, { useValue: root })
  container.register(WorktreeDirectoryToken, { useValue: () => '.atlas/worktrees' })
  container.register(WebSearchBackendToken, { useValue: () => EWebSearchBackend.DuckDuckGo })
  opened.push(container)
  return container
}

const toolsOf = (container: DependencyContainer): readonly ToolDefinition[] =>
  resolveSet({ container, token: portToken(ToolDefinition) })

const namesOf = (container: DependencyContainer): readonly string[] =>
  toolsOf(container).map((tool) => tool.name)

const registryOf = (container: DependencyContainer): ToolRegistry =>
  container.resolve(registeredPortToken(ToolRegistry))

const offeredNames = (container: DependencyContainer): readonly string[] =>
  registryOf(container)
    .declarations()
    .map((declaration) => declaration.name)

describe('the names the builtin registrations contribute', () => {
  it('gives every tool a name of its own, so no registration shadows another', () => {
    const names = namesOf(rooted())

    expect(names.length).toBeGreaterThan(0)
    expect(names.filter((name) => name.trim().length === 0)).toEqual([])
    expect(names.filter((name, index) => names.indexOf(name) !== index)).toEqual([])
  })

  it('offers exactly the registered names through the registry the loop reads', () => {
    const container = rooted()

    expect([...offeredNames(container)].sort()).toEqual([...namesOf(container)].sort())
  })

  it('answers each registered name with the tool that carries it', () => {
    const container = rooted()
    const registry = registryOf(container)

    expect(namesOf(container).filter((name) => registry.find(name)?.name !== name)).toEqual([])
    expect(registry.find('no_such_builtin')).toBeUndefined()
  })
})

describe('the dependencies each registration hands its tool', () => {
  it('resolves every tool with each dependency it was given defined', () => {
    const container = rooted()

    const undefinedDependencies = toolsOf(container).flatMap((tool) =>
      Object.entries(tool)
        .filter(([field, value]) => value === undefined && !BASE_CLASS_SLOTS.has(field))
        .map(([field]) => `${tool.name}.${field}`),
    )

    expect(undefinedDependencies).toEqual([])
  })
})

describe('the execution_location tool the registry withholds', () => {
  it('drops it from the registry in the cloud while the registration itself stays', () => {
    const container = rooted()
    const hostRegistry = registryOf(container)

    expect(hostRegistry.find('execution_location')).toBeDefined()
    expect(offeredNames(container)).toContain('execution_location')

    container.register(ExecutionLocationToken, {
      useValue: {
        state: createExecutionLocationState({ initial: EExecutionLocation.Cloud }),
        pinned: false,
      },
    })
    const cloudRegistry = registryOf(container)

    expect(cloudRegistry.find('execution_location')).toBeUndefined()
    expect(offeredNames(container)).not.toContain('execution_location')
    expect(offeredNames(container)).toHaveLength(namesOf(container).length - 1)
    expect(namesOf(container)).toContain('execution_location')
  })
})

class FixedSource extends DynamicToolSource {
  constructor(private readonly held: readonly ToolDefinition[]) {
    super()
  }

  declarations(): readonly ToolDeclaration[] {
    return this.held
  }

  find(name: string): ToolDefinition | undefined {
    return this.held.find((tool) => tool.name === name)
  }
}

describe('the dynamic sources the registry unions over the builtins', () => {
  it('offers and finds a tool from a source registered beside them', () => {
    const container = rooted()
    const sourced: ToolDefinition = {
      name: 'demo_source_tool',
      description: 'a tool a dynamic source contributed',
      effect: EToolEffect.Read,
      inputSchema: z.object({}),
      invoke: async () => ({
        ok: true,
        output: 'demo_source_tool',
        modelText: 'demo_source_tool ran',
      }),
    }
    container.register(portToken(DynamicToolSource), {
      useValue: new FixedSource([sourced]),
    })

    const registry = registryOf(container)

    expect(registry.find('demo_source_tool')).toBe(sourced)
    expect(offeredNames(container)).toContain('demo_source_tool')
    expect(offeredNames(container)).toContain('bash')
  })
})
