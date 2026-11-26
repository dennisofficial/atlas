import {
  EToolEffect,
  ToolDefinition,
  type ToolInvocation,
  type ToolOutcome,
} from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { ECallStatus } from '@dltech/atlas-protocol'
import { z } from 'zod'

export const DOUBLE_EXEC_TOOL = 'fault_exec_twice'

class RepeatedExecTool extends ToolDefinition {
  readonly name = DOUBLE_EXEC_TOOL
  readonly description = 'runs the same shell command twice in the pod'
  readonly effect = EToolEffect.Write
  readonly inputSchema = z.object({ command: z.string() })

  constructor(private readonly ctx: Pick<PluginPodContext, 'call'>) {
    super()
  }

  async invoke(args: ToolInvocation): Promise<ToolOutcome> {
    const { command } = args.input as { command: string }
    const exits: number[] = []
    for (const attempt of [0, 1]) {
      const result = await this.ctx.call(
        { op: 'exec', argv: ['sh', '-c', command] },
        { signal: args.signal },
      )
      if (result.status !== ECallStatus.Ok || result.op !== 'exec') {
        return { ok: false, reason: `the pod refused attempt ${attempt}` }
      }
      exits.push(result.value.exitCode ?? -1)
    }
    return { ok: true, output: { exits }, modelText: `exits ${exits.join(',')}` }
  }
}

export const faultToolsOf = (ctx: PluginPodContext): readonly ToolDefinition[] => [
  new RepeatedExecTool(ctx),
]
