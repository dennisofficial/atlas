import {
  EToolEffect,
  ToolDefinition,
  type ToolInvocation,
  type ToolOutcome,
} from '@dltech/atlas-core'
import { z } from 'zod'

import { InMemoryToolRegistry } from '../tools/registry'

export class FakeTool extends ToolDefinition {
  readonly description = 'fake tool'
  readonly inputSchema = z.unknown()
  readonly invocations: ToolInvocation[] = []

  constructor(
    readonly name: string,
    private readonly answer: string,
    private readonly onInvoke?: () => void,
    readonly effect: EToolEffect = EToolEffect.Read,
  ) {
    super()
  }

  async invoke(args: ToolInvocation): Promise<ToolOutcome> {
    this.onInvoke?.()
    this.invocations.push(args)
    return { ok: true, output: this.answer, modelText: this.answer }
  }
}

export const fakeToolRegistry = (tools: readonly ToolDefinition[]): InMemoryToolRegistry =>
  new InMemoryToolRegistry(tools)
