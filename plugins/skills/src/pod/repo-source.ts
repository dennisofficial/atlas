import { basename, extname, join } from 'node:path'

import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import type { DirectoryEntry } from '@dltech/atlas-protocol'

import {
  ESkillOrigin,
  frontmatterOf,
  skillFrontmatterOf,
  validateSkill,
  type SkillWarning,
} from '../core'
import { directoryOf, statOf, textOf } from './daemon'
import type { RepoCatalogueSkill } from './types'

export const REPO_SKILL_ROOTS: readonly string[] = ['.agents/skills']

const MARKDOWN = '.md'

const SKILL_ENTRY = /^skill\.md$/i

type Ctx = Pick<PluginPodContext, 'call'>

enum EEntryKind {
  Directory = 'directory',
  File = 'file',
  Other = 'other',
}

const kindOf = async (args: {
  ctx: Ctx
  path: string
  entry: DirectoryEntry
  signal?: AbortSignal | undefined
}): Promise<EEntryKind> => {
  if (args.entry.isDirectory) return EEntryKind.Directory
  if (args.entry.isFile) return EEntryKind.File

  const found = await statOf({ ctx: args.ctx, path: args.path, signal: args.signal })
  if (!found.ok) return EEntryKind.Other
  if (found.value.isDirectory) return EEntryKind.Directory
  return found.value.isFile ? EEntryKind.File : EEntryKind.Other
}

const skillAt = async (args: {
  ctx: Ctx
  directory: string
  entryPath: string
  fallbackName: string
  signal?: AbortSignal | undefined
}): Promise<RepoCatalogueSkill | undefined> => {
  const read = await textOf({ ctx: args.ctx, path: args.entryPath, signal: args.signal })
  if (!read.ok) return undefined

  const frontmatter = skillFrontmatterOf({
    fields: frontmatterOf(read.value),
    fallbackName: args.fallbackName,
  })
  const warnings: readonly SkillWarning[] = validateSkill({
    frontmatter,
    directoryName: args.fallbackName,
  })
  return {
    name: frontmatter.name,
    description: frontmatter.description,
    whenToUse: frontmatter.whenToUse,
    userInvocable: frontmatter.userInvocable,
    modelInvocable: frontmatter.modelInvocable,
    argumentHint: frontmatter.argumentHint,
    origin: ESkillOrigin.Repo,
    directory: args.directory,
    entryPath: args.entryPath,
    warnings,
  }
}

const entrySkillOf = async (args: {
  ctx: Ctx
  root: string
  entry: DirectoryEntry
  signal?: AbortSignal | undefined
}): Promise<RepoCatalogueSkill | undefined> => {
  const path = join(args.root, args.entry.name)
  const kind = await kindOf({ ctx: args.ctx, path, entry: args.entry, signal: args.signal })

  if (kind === EEntryKind.Directory) {
    const inside = await directoryOf({ ctx: args.ctx, path, signal: args.signal })
    if (!inside.ok) return undefined
    const filename = inside.value.find((candidate) => SKILL_ENTRY.test(candidate.name))?.name
    if (filename === undefined) return undefined
    return await skillAt({
      ctx: args.ctx,
      directory: path,
      entryPath: join(path, filename),
      fallbackName: args.entry.name,
      signal: args.signal,
    })
  }

  if (kind !== EEntryKind.File) return undefined
  const extension = extname(args.entry.name)
  if (extension.toLowerCase() !== MARKDOWN) return undefined
  return await skillAt({
    ctx: args.ctx,
    directory: args.root,
    entryPath: path,
    fallbackName: basename(args.entry.name, extension),
    signal: args.signal,
  })
}

const skillsUnder = async (args: {
  ctx: Ctx
  root: string
  signal?: AbortSignal | undefined
}): Promise<readonly RepoCatalogueSkill[]> => {
  const listed = await directoryOf({ ctx: args.ctx, path: args.root, signal: args.signal })
  if (!listed.ok) return []

  const found = await Promise.all(
    listed.value.map(
      async (entry) =>
        await entrySkillOf({ ctx: args.ctx, root: args.root, entry, signal: args.signal }),
    ),
  )
  return found.flatMap((skill) => (skill === undefined ? [] : [skill]))
}

export const discoverRepoSkills = async (args: {
  ctx: Ctx
  projectDirectory: string
  signal?: AbortSignal | undefined
}): Promise<readonly RepoCatalogueSkill[]> => {
  const perRoot = await Promise.all(
    REPO_SKILL_ROOTS.map(
      async (root) =>
        await skillsUnder({
          ctx: args.ctx,
          root: join(args.projectDirectory, root),
          signal: args.signal,
        }),
    ),
  )
  return perRoot.flatMap((skills) => [...skills])
}
