import { existsSync } from 'node:fs'

import {
  ToolDefinition,
  type EToolEffect,
  type ToolInvocation,
  type ToolOutcome,
} from '@dltech/atlas-core'
import type { ComposedPlugins } from '@dltech/atlas-plugin-sdk'
import type { ZodType } from 'zod'

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

export const gatedPluginsOf = (args: {
  plugins: ComposedPlugins
  raw: string | undefined
}): ComposedPlugins => {
  const gate = toolGateOf(args.raw)
  if (gate === undefined) return args.plugins
  return {
    ...args.plugins,
    pod: {
      ...args.plugins.pod,
      tools: (ctx) => gatedToolsOf({ gate, tools: args.plugins.pod.tools(ctx) }),
    },
  }
}

export const rigPluginsOf = (plugins: ComposedPlugins): ComposedPlugins | undefined =>
  process.env.FAULT_PLUGINS === '1'
    ? gatedPluginsOf({ plugins, raw: process.env.PLUGIN_TOOL_GATE })
    : undefined
