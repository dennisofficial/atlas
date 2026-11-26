import { existsSync } from 'node:fs'

import {
  ToolDefinition,
  type EToolEffect,
  type ToolInvocation,
  type ToolOutcome,
} from '@dltech/atlas-core'
import type { ComposedPlugins } from '@dltech/atlas-plugin-sdk'
import type { ZodType } from 'zod'

import { faultLoadResource } from './fault-resources'
import { faultToolsOf } from './fault-tools'

export type ToolGate = {
  tool: string
  waitFor: string
  phase: 'before' | 'after'
}

const POLL_MS = 20
const NEVER_MS = 10 * 60_000

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

export const waitForGate = async (path: string): Promise<void> => {
  const deadline = Date.now() + NEVER_MS
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error(`the gate ${path} never opened`)
    await sleep(POLL_MS)
  }
}

/**
 * Holds a plugin tool between its dispatch and its first pod operation (`before`), or between the
 * pod work and the tool result (`after`), until the scenario opens the gate file. A host that
 * never opens it is killed in exactly that window.
 */
class GatedTool extends ToolDefinition {
  constructor(private readonly args: { inner: ToolDefinition; gate: ToolGate }) {
    super()
  }

  override get name(): string {
    return this.args.inner.name
  }

  override get description(): string {
    return this.args.inner.description
  }

  override get effect(): EToolEffect {
    return this.args.inner.effect
  }

  override get inputSchema(): ZodType {
    return this.args.inner.inputSchema
  }

  async invoke(args: ToolInvocation): Promise<ToolOutcome> {
    if (this.args.gate.phase === 'before') await waitForGate(this.args.gate.waitFor)
    const outcome = await this.args.inner.invoke(args)
    if (this.args.gate.phase === 'after') await waitForGate(this.args.gate.waitFor)
    return outcome
  }
}

export const gatedToolsOf = (args: {
  gate: ToolGate
  tools: readonly ToolDefinition[]
}): readonly ToolDefinition[] =>
  args.tools.map((tool) =>
    tool.name === args.gate.tool ? new GatedTool({ inner: tool, gate: args.gate }) : tool,
  )

export const toolGateOf = (raw: string | undefined): ToolGate | undefined => {
  if (raw === undefined || raw === '') return undefined
  return JSON.parse(raw) as ToolGate
}

export const riggedPluginsOf = (args: {
  plugins: ComposedPlugins
  gate: ToolGate | undefined
  faultTools: boolean
  faultResources: boolean
}): ComposedPlugins => {
  if (args.gate === undefined && !args.faultTools && !args.faultResources) return args.plugins
  const { plugins, gate } = args
  return {
    ...plugins,
    pod: {
      ...plugins.pod,
      tools: (ctx) => [
        ...(gate === undefined
          ? plugins.pod.tools(ctx)
          : gatedToolsOf({ gate, tools: plugins.pod.tools(ctx) })),
        ...(args.faultTools ? faultToolsOf(ctx) : []),
      ],
      resources: [...plugins.pod.resources, ...(args.faultResources ? [faultLoadResource()] : [])],
    },
  }
}

export const rigPluginsOf = (plugins: ComposedPlugins): ComposedPlugins | undefined =>
  process.env.FAULT_PLUGINS === '1'
    ? riggedPluginsOf({
        plugins,
        gate: toolGateOf(process.env.PLUGIN_TOOL_GATE),
        faultTools: process.env.FAULT_TOOLS === '1',
        faultResources: process.env.FAULT_RESOURCES === '1',
      })
    : undefined
