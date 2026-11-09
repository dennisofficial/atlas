import {
  EToolEffect,
  ToolDefinition,
  type ModelPart,
  type ToolInvocation,
  type ToolOutcome,
} from '@dltech/atlas-core'
import { z } from 'zod'

import { renderCall } from './render'
import { McpUnauthorizedError, messageOf, type McpCallResult, type McpToolInfo } from './types'

export const MCP_NAME_PREFIX = 'mcp__'

export type McpToolCaller = {
  name: string
  call(args: { tool: string; input: unknown }): Promise<McpCallResult>
}

const effectOf = (info: McpToolInfo): EToolEffect => {
  if (info.annotations?.readOnlyHint === true) return EToolEffect.Read
  if (info.annotations?.destructiveHint === true) return EToolEffect.Destructive
  return EToolEffect.Write
}

export const bridgeNameOf = (server: string, tool: string): string =>
  `${MCP_NAME_PREFIX}${server}__${tool}`

export class McpBridgeTool extends ToolDefinition {
  override readonly name: string
  override readonly description: string
  override readonly effect: EToolEffect
  override readonly inputSchema = z.record(z.string(), z.unknown())

  readonly server: string
  readonly tool: string
  readonly jsonSchema: unknown
  private readonly caller: () => McpToolCaller | undefined

  constructor(args: {
    server: string
    info: McpToolInfo
    caller: () => McpToolCaller | undefined
  }) {
    super()
    this.server = args.server
    this.tool = args.info.name
    this.name = bridgeNameOf(args.server, args.info.name)
    this.description = args.info.description ?? this.name
    this.effect = effectOf(args.info)
    this.jsonSchema = args.info.inputSchema
    this.caller = args.caller
    if (this.effect === EToolEffect.Read) this.isConcurrencySafe = () => true
  }

  override async invoke(args: ToolInvocation): Promise<ToolOutcome> {
    const caller = this.caller()
    if (caller === undefined)
      return { ok: false, reason: `the '${this.server}' MCP server is not connected` }

    let result: McpCallResult
    try {
      result = await caller.call({ tool: this.tool, input: args.input })
    } catch (error) {
      if (error instanceof McpUnauthorizedError)
        return { ok: false, reason: `the '${this.server}' MCP server needs a sign-in` }
      return {
        ok: false,
        reason: `the '${this.server}' MCP server rejected the call: ${messageOf(error)}`,
      }
    }

    const rendered = renderCall(result)
    if (result.isError === true) return { ok: false, reason: rendered.text }

    const parts: readonly ModelPart[] = rendered.parts
    return {
      ok: true,
      output: {
        server: this.server,
        tool: this.tool,
        ...(result.structuredContent !== undefined
          ? { structuredContent: result.structuredContent }
          : { content: result.content }),
      },
      modelText: rendered.text,
      ...(parts.length > 0 ? { modelParts: parts } : {}),
    }
  }
}
