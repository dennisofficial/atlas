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
  POD_WAIT_INTERRUPTED,
  type DaemonAgentFileSystemPort,
  type DaemonFileSystemPort,
  type DaemonProcessPort,
  type WorkspaceGate,
} from '@dltech/atlas-host'

import { BashTool } from '../agent-tools/bash'
import { EditTool } from '../agent-tools/edit'
import { GlobTool } from '../agent-tools/glob'
import { GrepTool } from '../agent-tools/grep'
import { MultiEditTool } from '../agent-tools/multi-edit'
import { ReadTool } from '../agent-tools/read'
import { SerializedWrites } from '../agent-tools/write-guard'
import { WriteTool } from '../agent-tools/write'
import type { ShellLauncher } from '../agent-tools/shell-launcher'
import type { PathEnvironment } from './session-paths'

export class SetupGatedTool extends ToolDefinition {
  readonly name: string
  readonly description: string
  readonly effect: EToolEffect
  readonly inputSchema: ZodType
  declare readonly pathFields?: PathFieldClaim
  declare readonly claimsDeeds?: DeedClaim | undefined

  constructor(
    private readonly inner: ToolDefinition,
    private readonly gate: WorkspaceGate,
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
    const workspace = await this.gate.wait(args.signal)
    if (workspace.state === 'aborted') return { ok: false, reason: POD_WAIT_INTERRUPTED }
    if (workspace.state === 'failed') return { ok: false, reason: workspace.message }
    return this.inner.invoke(args)
  }
}

export const daemonToolsOf = (args: {
  processes: DaemonProcessPort
  files: DaemonFileSystemPort
  agentFiles: DaemonAgentFileSystemPort
  pathEnv: PathEnvironment
  gate: WorkspaceGate
  launcher: ShellLauncher
  shellEnv?: (() => Promise<Record<string, string>>) | undefined
}): ToolDefinition[] => {
  const guard = new SerializedWrites()
  const tools: ToolDefinition[] = [
    new ReadTool({ files: args.agentFiles, pathEnv: args.pathEnv }),
    new WriteTool(guard, args.agentFiles, args.pathEnv),
    new EditTool(guard, args.agentFiles, args.pathEnv),
    new MultiEditTool(guard, args.agentFiles, args.pathEnv),
    new GrepTool(args.processes, args.agentFiles, args.pathEnv),
    new GlobTool(args.agentFiles, args.pathEnv),
    new BashTool({
      launcher: args.launcher,
      files: args.files,
      processes: args.processes,
      shellEnv: args.shellEnv,
    }),
  ]
  return tools.map((tool) => new SetupGatedTool(tool, args.gate))
}
