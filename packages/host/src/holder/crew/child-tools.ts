import { ToolRegistry } from '@dltech/atlas-agent'
import type { ToolDeclaration, ToolDefinition } from '@dltech/atlas-core'

export class DeniedToolRegistry extends ToolRegistry {
  private readonly denied: ReadonlySet<string>

  constructor(
    private readonly base: ToolRegistry,
    deny: readonly string[],
  ) {
    super()
    this.denied = new Set(deny)
  }

  declarations(): readonly ToolDeclaration[] {
    return this.base.declarations().filter((declaration) => !this.denied.has(declaration.name))
  }

  find(name: string): ToolDefinition | undefined {
    return this.denied.has(name) ? undefined : this.base.find(name)
  }
}
