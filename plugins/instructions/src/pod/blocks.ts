import { join } from 'node:path'

import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { statOf, textOf } from './daemon'
import { INSTRUCTION_FILE, MAX_INSTRUCTION_BYTES } from './sources'

type Ctx = Pick<PluginPodContext, 'call'>

export const PERSONAL_HEADER =
  "The operator's personal instructions from Atlas Cloud. They apply to every project:"

export const projectHeader = (path: string): string =>
  `Contents of ${path} (project instructions, checked into the codebase):`

export const blockOf = (args: { header: string; content: string }): string | null => {
  const content = args.content.trim()
  return content === '' ? null : `${args.header}\n\n${content}`
}

export const instructionFileOf = async (args: {
  ctx: Ctx
  directory: string
  cache: Map<string, Promise<string | null>>
}): Promise<string | null> => {
  const path = join(args.directory, INSTRUCTION_FILE)
  const kept = args.cache.get(path)
  if (kept !== undefined) return await kept
  const reading = readInstruction({ ctx: args.ctx, path })
  args.cache.set(path, reading)
  return await reading
}

const readInstruction = async (args: { ctx: Ctx; path: string }): Promise<string | null> => {
  const stat = await statOf({ ctx: args.ctx, path: args.path })
  if (!stat.ok || !stat.value.isFile || stat.value.size > MAX_INSTRUCTION_BYTES) return null
  const text = await textOf({ ctx: args.ctx, path: args.path })
  return text.ok ? text.value : null
}
