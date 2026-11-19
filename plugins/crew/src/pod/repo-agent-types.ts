import { basename, extname, join } from 'node:path'

import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { parseRepoAgentType, type RepoAgentRefusal, type RepoAgentType } from '../core'
import { directoryOf, statOf, textOf } from './daemon'

export const REPO_AGENT_ROOTS: readonly string[] = ['.agents/agents']

const MARKDOWN = '.md'

type Ctx = Pick<PluginPodContext, 'call'>

type Entry = { name: string; isFile: boolean; isDirectory: boolean }

export type RepoAgentTypes = {
  types: readonly RepoAgentType[]
  refusals: readonly RepoAgentRefusal[]
}

const markdownOf = async (args: {
  ctx: Ctx
  path: string
  entry: Entry
  signal?: AbortSignal | undefined
}): Promise<boolean> => {
  const extension = extname(args.entry.name)
  if (extension.toLowerCase() !== MARKDOWN) return false
  if (args.entry.isFile) return true
  if (args.entry.isDirectory) return false
  const found = await statOf({ ctx: args.ctx, path: args.path, signal: args.signal })
  return found.ok && found.value.isFile
}

export const discoverRepoAgentTypes = async (args: {
  ctx: Ctx
  projectDirectory: string
  signal?: AbortSignal | undefined
}): Promise<RepoAgentTypes> => {
  const types: RepoAgentType[] = []
  const refusals: RepoAgentRefusal[] = []
  const definedIn = new Map<string, string>()

  for (const root of REPO_AGENT_ROOTS) {
    const listed = await directoryOf({
      ctx: args.ctx,
      path: join(args.projectDirectory, root),
      signal: args.signal,
    })
    if (!listed.ok) continue

    const entries = [...listed.value].sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const path = join(args.projectDirectory, root, entry.name)
      if (!(await markdownOf({ ctx: args.ctx, path, entry, signal: args.signal }))) continue

      const read = await textOf({ ctx: args.ctx, path, signal: args.signal })
      const at = join(root, entry.name)
      const parsed = read.ok
        ? parseRepoAgentType({
            text: read.value,
            fallbackName: basename(entry.name, extname(entry.name)),
            definedIn: at,
          })
        : {
            ok: false as const,
            refusal: {
              name: basename(entry.name, extname(entry.name)),
              definedIn: at,
              reason: `could not be read: ${read.reason}`,
            },
          }

      if (!parsed.ok) {
        refusals.push(parsed.refusal)
        continue
      }

      const shadowed = definedIn.get(parsed.type.name)
      if (shadowed !== undefined) {
        refusals.push({
          name: parsed.type.name,
          definedIn: at,
          reason: `is shadowed by ${shadowed}`,
        })
        continue
      }

      definedIn.set(parsed.type.name, at)
      types.push(parsed.type)
    }
  }

  return { types, refusals }
}

export const repoAgentTypeOf = async (args: {
  ctx: Ctx
  projectDirectory: string
  name: string
  signal?: AbortSignal | undefined
}): Promise<RepoAgentType | undefined> => {
  const found = await discoverRepoAgentTypes({
    ctx: args.ctx,
    projectDirectory: args.projectDirectory,
    signal: args.signal,
  })
  return found.types.find((type) => type.name === args.name)
}
