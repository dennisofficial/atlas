import { z } from 'zod'

import { FNV_OFFSET, FNV_PRIME } from '../services/port'
import type { ToolDeclaration } from '../tools/tool'
import type { Assembled } from './assembled'

const SEPARATOR = '\u0000'

const fnvHexOf = (text: string): string => {
  let hash = FNV_OFFSET
  for (const character of text) {
    hash = Math.imul(hash ^ (character.codePointAt(0) ?? 0), FNV_PRIME) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

const jsonOf = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return ''
  }
}

const schemaOf = (tool: ToolDeclaration): unknown => {
  try {
    return tool.jsonSchema ?? z.toJSONSchema(tool.inputSchema, { io: 'input' })
  } catch {
    return null
  }
}

const toolTextOf = (tool: ToolDeclaration): string =>
  [tool.name, tool.description, jsonOf(schemaOf(tool))].join(SEPARATOR)

/** One short hash per cacheable request region, so two calls show which region changed. */
export function requestHashesOf(args: {
  assembled: Assembled
  tools: readonly ToolDeclaration[]
}): Readonly<Record<string, string>> {
  const systemTexts = new Map<string, string[]>()
  for (const block of args.assembled.system) {
    const key = `system.${block.source ?? 'other'}`
    systemTexts.set(key, [...(systemTexts.get(key) ?? []), block.text])
  }

  const hashes: Record<string, string> = {}
  for (const [key, texts] of systemTexts) hashes[key] = fnvHexOf(texts.join(SEPARATOR))
  hashes.tools = fnvHexOf(args.tools.map(toolTextOf).join(SEPARATOR))
  hashes.requestOptions = fnvHexOf(jsonOf(args.assembled.requestOptions ?? null))
  return hashes
}
