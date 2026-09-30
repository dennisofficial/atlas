import type { DynamicToolSource, ToolDeclaration, ToolDefinition } from '@dltech/atlas-core'

import { ToolRegistry } from './registry'

/**
 * The registry the loop and dispatch are handed: the static set the base registry holds plus every
 * dynamic source the container contributed. Both reads are live, so a source whose set changes
 * mid-session is reflected in the next `declarations()` call rather than at the next boot.
 */
export class CompositeToolRegistry extends ToolRegistry {
  private readonly base: ToolRegistry
  private readonly sources: readonly DynamicToolSource[]
  private readonly available: (name: string) => boolean

  constructor(args: { base: ToolRegistry; sources: readonly DynamicToolSource[]; available?: ((name: string) => boolean) | undefined }) {
    super()
    this.base = args.base
    this.sources = args.sources
    this.available = args.available ?? (() => true)
  }

  declarations(): readonly ToolDeclaration[] {
    return [...this.base.declarations(), ...this.sources.flatMap((source) => source.declarations())]
      .filter((tool) => this.available(tool.name))
  }

  find(name: string): ToolDefinition | undefined {
    if (!this.available(name)) return undefined
    const builtIn = this.base.find(name)
    if (builtIn !== undefined) return builtIn

    for (const source of this.sources) {
      const found = source.find(name)
      if (found !== undefined) return found
    }
    return undefined
  }
}
