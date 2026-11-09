import { describe, expect, it } from 'bun:test'

import { ToolRegistry, InMemoryToolRegistry } from '@dltech/atlas-agent'
import { EToolEffect, ToolDefinition, type ToolOutcome } from '@dltech/atlas-core'
import { z } from 'zod'

import { ComposedPodRegistry } from '../plugin-pod'

class ProbeTool extends ToolDefinition {
  readonly description = 'probe'
  readonly effect = EToolEffect.Read
  readonly inputSchema = z.object({})

  constructor(readonly name: string) {
    super()
  }

  async invoke(): Promise<ToolOutcome> {
    return { ok: true, output: this.name, modelText: this.name }
  }
}

const registryOf = (names: readonly string[]): ToolRegistry =>
  new InMemoryToolRegistry(names.map((name) => new ProbeTool(name)))

const namesIn = (registry: ToolRegistry): readonly string[] =>
  registry.declarations().map((declaration) => declaration.name)

describe('ComposedPodRegistry', () => {
  it('offers the base tools and the plugin tools', () => {
    const registry = new ComposedPodRegistry(registryOf(['bash']), () => [
      new ProbeTool('mcp__a__b'),
    ])
    expect(namesIn(registry)).toEqual(['bash', 'mcp__a__b'])
    expect(registry.find('mcp__a__b')?.name).toBe('mcp__a__b')
    expect(registry.find('bash')?.name).toBe('bash')
    expect(registry.find('missing')).toBeUndefined()
  })

  it('refuses a tool that repeats a base tool name at claim', () => {
    expect(
      () => new ComposedPodRegistry(registryOf(['bash']), () => [new ProbeTool('bash')]),
    ).toThrow('two tools are registered as "bash"')
  })

  it('refuses two plugin tools with one name at claim', () => {
    expect(
      () =>
        new ComposedPodRegistry(registryOf([]), () => [
          new ProbeTool('twin'),
          new ProbeTool('twin'),
        ]),
    ).toThrow('two tools are registered as "twin"')
  })

  it('offers a plugin tool that appears after the claim, on the next read', () => {
    let live = [new ProbeTool('first')]
    const registry = new ComposedPodRegistry(registryOf(['bash']), () => live)
    expect(namesIn(registry)).toEqual(['bash', 'first'])

    live = [new ProbeTool('first'), new ProbeTool('late')]
    expect(namesIn(registry)).toEqual(['bash', 'first', 'late'])
    expect(registry.find('late')?.name).toBe('late')
  })

  it('stops offering a tool that leaves, and cannot find it by name', () => {
    let live = [new ProbeTool('fleeting'), new ProbeTool('stays')]
    const registry = new ComposedPodRegistry(registryOf([]), () => live)
    expect(namesIn(registry)).toEqual(['fleeting', 'stays'])

    live = [new ProbeTool('stays')]
    expect(namesIn(registry)).toEqual(['stays'])
    expect(registry.find('fleeting')).toBeUndefined()
  })

  it('drops a duplicate that appears after the claim instead of wedging the turn', () => {
    const logs: string[] = []
    let live = [new ProbeTool('first')]
    const registry = new ComposedPodRegistry(
      registryOf(['bash']),
      () => live,
      (message) => logs.push(message),
    )

    live = [new ProbeTool('first'), new ProbeTool('first')]
    expect(namesIn(registry)).toEqual(['bash', 'first'])
    expect(logs).toEqual(['dropped a duplicate tool "first"'])

    live = [new ProbeTool('bash')]
    expect(namesIn(registry)).toEqual(['bash'])
    expect(logs).toEqual(['dropped a duplicate tool "first"', 'dropped a duplicate tool "bash"'])
  })
})
