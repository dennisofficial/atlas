import { z } from 'zod'

import type { Message } from '../message/message'
import type { MessagePart, ToolResultOutput } from '../message/parts'
import type { ToolDeclaration } from '../tools/tool'
import type { Assembled } from './assembled'

const MCP_PREFIX = 'mcp__'
const CONTEXT_SOURCE_PREFIX = '<system-context source="'

type Sizes = Record<string, number>

const add = (sizes: Sizes, key: string, chars: number): void => {
  sizes[key] = (sizes[key] ?? 0) + chars
}

const jsonCharsOf = (value: unknown): number => {
  try {
    return JSON.stringify(value)?.length ?? 0
  } catch {
    return 0
  }
}

const outputCharsOf = (output: ToolResultOutput): number => {
  if (output.type === 'text' || output.type === 'error-text') return output.value.length
  if (output.type === 'json' || output.type === 'error-json') return jsonCharsOf(output.value)
  return output.value.reduce(
    (total, part) => total + (part.type === 'text' ? part.text.length : 0),
    0,
  )
}

const partCharsOf = (part: MessagePart): number => {
  if (part.type === 'text' || part.type === 'reasoning') return part.text.length
  if (part.type === 'tool-call') return jsonCharsOf(part.input)
  if (part.type === 'tool-result') return outputCharsOf(part.output)
  return 0
}

const contextSourceOf = (part: MessagePart): string | undefined => {
  if (part.type !== 'text') return undefined
  if (!part.text.startsWith(CONTEXT_SOURCE_PREFIX)) return undefined
  const closing = part.text.indexOf('"', CONTEXT_SOURCE_PREFIX.length)
  return closing === -1 ? undefined : part.text.slice(CONTEXT_SOURCE_PREFIX.length, closing)
}

const mcpServerOf = (toolName: string): string | undefined => {
  if (!toolName.startsWith(MCP_PREFIX)) return undefined
  const rest = toolName.slice(MCP_PREFIX.length)
  const separator = rest.indexOf('__')
  return separator <= 0 ? undefined : rest.slice(0, separator)
}

const schemaCharsOf = (tool: ToolDeclaration): number => {
  try {
    return jsonCharsOf(tool.jsonSchema ?? z.toJSONSchema(tool.inputSchema, { io: 'input' }))
  } catch {
    return 0
  }
}

const messageSizes = (args: { message: Message; sizes: Sizes }): number => {
  let chars = 0
  for (const part of args.message.content) {
    const partChars = partCharsOf(part)
    chars += partChars
    const source = args.message.role === 'user' ? contextSourceOf(part) : undefined
    if (source !== undefined) add(args.sizes, `messages.context.${source}`, partChars)
  }
  return chars
}

export function requestSizeOf(args: {
  assembled: Assembled
  tools: readonly ToolDeclaration[]
}): Readonly<Record<string, number>> {
  const sizes: Sizes = {}

  let systemChars = 0
  for (const block of args.assembled.system) {
    add(sizes, `system.${block.source ?? 'other'}`, block.text.length)
    systemChars += block.text.length
  }

  let toolChars = 0
  for (const tool of args.tools) {
    const server = mcpServerOf(tool.name)
    const key = server === undefined ? 'tools.builtin' : `tools.mcp.${server}`
    const chars = tool.description.length + schemaCharsOf(tool)
    add(sizes, key, chars)
    add(sizes, `${key}.count`, 1)
    toolChars += chars
  }

  let messageChars = 0
  for (const entry of args.assembled.messages) {
    messageChars += messageSizes({ message: entry.message, sizes })
  }
  add(sizes, 'messages', messageChars)

  add(sizes, 'total', systemChars + toolChars + messageChars)
  return sizes
}
