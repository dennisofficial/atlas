import {
  ToolDefinition,
  type DeedClaim,
  type EToolEffect,
  type PathFieldClaim,
  type RevealedLines,
  type ToolInvocation,
  type ToolOutcome,
  type WholeFileClaim,
} from '@dltech/atlas-core'
import type { ZodType } from 'zod'
import {
  BashTool,
  EditTool,
  GlobTool,
  GrepTool,
  MultiEditTool,
  ReadTool,
  SerializedWrites,
  WriteTool,
} from '@dltech/atlas-harness'
import type {
  DaemonAgentFileSystemPort,
  DaemonFileSystemPort,
  DaemonProcessPort,
} from '@dltech/atlas-host'

import { ForegroundOnlyShells } from './foreground-shells'

export class SetupGatedTool extends ToolDefinition {
  readonly name: string
  readonly description: string
  readonly effect: EToolEffect
  readonly inputSchema: ZodType
  declare readonly pathFields?: PathFieldClaim
  declare readonly claimsDeeds?: DeedClaim | undefined

  constructor(
    private readonly inner: ToolDefinition,
    private readonly setup: Promise<void>,
  ) {
    super()
    this.name = inner.name
    this.description = inner.description
    this.effect = inner.effect
    this.inputSchema = inner.inputSchema
    if (inner.pathFields !== undefined) this.pathFields = inner.pathFields
    this.claimsDeeds = inner.claimsDeeds
  }

  override isConcurrencySafe(input: unknown): boolean {
    return this.inner.isConcurrencySafe?.(input) ?? false
  }

  override revealsWholeFile(args: WholeFileClaim<unknown>): boolean {
    return this.inner.revealsWholeFile?.(args) ?? false
  }

  override revealsLinesOf(args: RevealedLines<unknown>): readonly string[] {
    return this.inner.revealsLinesOf?.(args) ?? []
  }

  async invoke(args: ToolInvocation): Promise<ToolOutcome> {
    await this.setup
    return this.inner.invoke(args)
  }
}

export const daemonToolsOf = (args: {
  processes: DaemonProcessPort
  files: DaemonFileSystemPort
  agentFiles: DaemonAgentFileSystemPort
  setup: Promise<void>
}): ToolDefinition[] => {
  const guard = new SerializedWrites()
  const tools: ToolDefinition[] = [
    new ReadTool({ files: args.agentFiles }),
    new WriteTool(guard, args.agentFiles),
    new EditTool(guard, args.agentFiles),
    new MultiEditTool(guard, args.agentFiles),
    new GrepTool(args.processes, args.agentFiles),
    new GlobTool(args.agentFiles),
    new BashTool(new ForegroundOnlyShells(), args.files, args.processes),
  ]
  return tools.map((tool) => new SetupGatedTool(tool, args.setup))
}
