import { ToolRegistry } from '@dltech/atlas-agent'
import type { ToolDeclaration, ToolDefinition } from '@dltech/atlas-core'

export class ComposedPodRegistry extends ToolRegistry {
  private readonly taken: ReadonlySet<string>
  private settled = false

  constructor(
    private readonly base: ToolRegistry,
    private readonly toolsOf: () => readonly ToolDefinition[],
    private readonly log: (message: string) => void = () => {},
  ) {
    super()
    this.taken = new Set(base.declarations().map((declaration) => declaration.name))
    this.extras()
  }

  declarations(): readonly ToolDeclaration[] {
    return [...this.base.declarations(), ...this.extras().values()]
  }

  find(name: string): ToolDefinition | undefined {
    return this.extras().get(name) ?? this.base.find(name)
  }

  private extras(): ReadonlyMap<string, ToolDefinition> {
    const byName = new Map<string, ToolDefinition>()
    for (const tool of this.toolsOf()) {
      if (!byName.has(tool.name) && !this.taken.has(tool.name)) {
        byName.set(tool.name, tool)
        continue
      }
      if (!this.settled) throw new Error(`two tools are registered as "${tool.name}"`)
      this.log(`dropped a duplicate tool "${tool.name}"`)
    }
    this.settled = true
    return byName
  }
}
