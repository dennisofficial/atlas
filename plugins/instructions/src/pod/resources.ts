import { join } from 'node:path'

import { ECloudSetting, type PluginPodContext, type PodResource } from '@dltech/atlas-plugin-sdk'
import { z } from 'zod'

import { pathsOf, textOf } from './daemon'
import { INSTRUCTION_FILE, MAX_INSTRUCTION_BYTES, repoRootOf } from './sources'

export const INSTRUCTIONS_RESOURCE = 'instructions'

export const MAX_INSTRUCTION_FILES = 64

const SKIP = new Set(['node_modules', '.git'])

export type InstructionsPodOptions = {
  personal(ctx: PluginPodContext): Promise<string | null>
}

export type InstructionsSnapshot = {
  root: string
  directory: string
  personal: string | null
  files: Record<string, string>
}

const snapshotSchema: z.ZodType<InstructionsSnapshot> = z.object({
  root: z.string(),
  directory: z.string(),
  personal: z.string().nullable(),
  files: z.record(z.string(), z.string()),
})

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const readablePath = (path: string): boolean =>
  path.split('/').every((segment) => !SKIP.has(segment))

const personalOf = async (args: {
  ctx: PluginPodContext
  options: InstructionsPodOptions
}): Promise<string | null> =>
  await args.options.personal(args.ctx).catch((error: unknown) => {
    args.ctx.log(`personal instructions unavailable: ${messageOf(error)}`)
    return null
  })

const CONCURRENT_READS = 16

const textsOf = async (args: {
  ctx: PluginPodContext
  paths: readonly string[]
}): Promise<readonly (string | undefined)[]> => {
  const texts: (string | undefined)[] = args.paths.map(() => undefined)
  let next = 0

  const readOne = async (): Promise<void> => {
    for (;;) {
      const index = next
      next += 1
      const path = args.paths[index]
      if (path === undefined) return
      const read = await textOf({ ctx: args.ctx, path })
      texts[index] = read.ok ? read.value : undefined
    }
  }

  const readers = Math.min(CONCURRENT_READS, args.paths.length)
  await Promise.all(Array.from({ length: readers }, async () => await readOne()))
  return texts
}

const filesUnder = async (args: {
  ctx: PluginPodContext
  root: string
}): Promise<Record<string, string>> => {
  const found = await pathsOf({ ctx: args.ctx, pattern: `**/${INSTRUCTION_FILE}`, cwd: args.root })
  if (!found.ok) return {}

  const candidates = found.value.filter(readablePath).map((relative) => join(args.root, relative))
  const texts = await textsOf({ ctx: args.ctx, paths: candidates })

  const files: Record<string, string> = {}
  for (const [index, path] of candidates.entries()) {
    const text = texts[index]
    if (text === undefined || Buffer.byteLength(text, 'utf8') > MAX_INSTRUCTION_BYTES) continue
    files[path] = text
    if (Object.keys(files).length >= MAX_INSTRUCTION_FILES) break
  }
  return files
}

export const instructionsResource = (
  options: InstructionsPodOptions,
): PodResource<InstructionsSnapshot> => ({
  name: INSTRUCTIONS_RESOURCE,
  schema: snapshotSchema,
  watch: (directory) => ({ roots: [directory], basenames: [INSTRUCTION_FILE] }),
  cloud: [ECloudSetting.PersonalInstructions],
  load: async ({ ctx, directory }) => {
    const [root, personal] = await Promise.all([
      repoRootOf({ ctx, directory }),
      personalOf({ ctx, options }),
    ])
    return {
      root,
      directory,
      personal,
      files: await filesUnder({ ctx, root }),
    }
  },
})
