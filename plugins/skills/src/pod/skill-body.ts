import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { ESkillOrigin, expandSkillBody, skillBodyOf } from '../core'
import type { SkillCatalogue } from './catalogue'
import { textOf } from './daemon'
import type { CloudSkillBody } from './port'
import type { SkillsPodOptions } from './resources'
import type {
  BuiltInCatalogueSkill,
  CatalogueSkill,
  CloudCatalogueSkill,
  RepoCatalogueSkill,
} from './types'

const SUGGESTION_LIMIT = 3

export const SKILLS_UNREADABLE_REASON = 'the skills could not be read in this session'

export const isRepoSkill = (skill: CatalogueSkill): skill is RepoCatalogueSkill =>
  'entryPath' in skill

export const isBuiltInSkill = (skill: CatalogueSkill): skill is BuiltInCatalogueSkill =>
  'text' in skill

export const isCloudSkill = (skill: CatalogueSkill): skill is CloudCatalogueSkill =>
  skill.origin === ESkillOrigin.CloudUser ||
  skill.origin === ESkillOrigin.CloudGroup ||
  skill.origin === ESkillOrigin.CloudProject

const editDistance = (left: string, right: string): number => {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)

  for (let row = 1; row <= left.length; row += 1) {
    const current = [row]
    for (let column = 1; column <= right.length; column += 1) {
      const matched = left[row - 1] === right[column - 1]
      current.push(
        Math.min(
          (previous[column - 1] ?? 0) + (matched ? 0 : 1),
          (previous[column] ?? 0) + 1,
          (current[column - 1] ?? 0) + 1,
        ),
      )
    }
    previous = current
  }

  return previous[right.length] ?? 0
}

const nearestNames = (args: { requested: string; names: readonly string[] }): readonly string[] =>
  args.names
    .map((name) => ({ name, distance: editDistance(args.requested, name) }))
    .filter(
      (one) => one.distance <= Math.ceil(Math.max(args.requested.length, one.name.length) / 2),
    )
    .sort((left, right) => left.distance - right.distance || left.name.localeCompare(right.name))
    .slice(0, SUGGESTION_LIMIT)
    .map((one) => one.name)

export const unknownReason = (args: { requested: string; catalogue: SkillCatalogue }): string => {
  const names = args.catalogue.skills
    .filter((skill) => skill.modelInvocable)
    .map((skill) => skill.name)
  if (names.length === 0) return `no skill is named ${args.requested}, and none is available to you`

  const nearest = nearestNames({ requested: args.requested, names })
  if (nearest.length === 0)
    return `no skill is named ${args.requested}; the listing in your system prompt names the ones you have`
  return `no skill is named ${args.requested}; the closest are ${nearest.join(', ')}`
}

const directoryNoteOf = (skill: CatalogueSkill): string =>
  skill.directory === null
    ? ''
    : `The ${skill.name} skill is installed at ${skill.directory}. Every relative path below names a file inside that directory. Read one by joining it onto that path rather than onto the project directory.`

const bundlesFiles = (skill: CatalogueSkill): boolean =>
  isCloudSkill(skill) || (isBuiltInSkill(skill) && skill.files.length > 0)

const bundledNoteOf = (skill: CatalogueSkill): string =>
  bundlesFiles(skill)
    ? `The ${skill.name} skill has no directory in this session. Read a file it bundles by calling this tool again with path set to that file's path.`
    : ''

export const noteOf = (skill: CatalogueSkill): string =>
  directoryNoteOf(skill) || bundledNoteOf(skill)

export const entryPathOf = (skill: CatalogueSkill): string | null =>
  isRepoSkill(skill) ? skill.entryPath : null

export const skillTextOf = async (args: {
  ctx: PluginPodContext
  options: SkillsPodOptions
  skill: CatalogueSkill
}): Promise<CloudSkillBody | null> => {
  if (isBuiltInSkill(args.skill)) return { text: args.skill.text, revision: 0, hash: '' }
  if (isRepoSkill(args.skill)) {
    const read = await textOf({ ctx: args.ctx, path: args.skill.entryPath })
    return read.ok ? { text: read.value, revision: 0, hash: '' } : null
  }
  return await args.options.cloud(args.ctx).body({
    name: args.skill.name,
    description: args.skill.description,
    scope: args.skill.scope,
  })
}

export type LoadedSkillBody = {
  body: string
  note: string
  revision: number
  hash: string
}

export const loadSkillBodyOf = async (args: {
  ctx: PluginPodContext
  options: SkillsPodOptions
  skill: CatalogueSkill
  argumentText: string
}): Promise<{ ok: true; loaded: LoadedSkillBody } | { ok: false; reason: string }> => {
  const text = await skillTextOf(args)
  if (text === null)
    return { ok: false, reason: `the ${args.skill.name} skill's text could not be read` }

  return {
    ok: true,
    loaded: {
      body: expandSkillBody({ body: skillBodyOf(text.text), argumentText: args.argumentText }),
      note: noteOf(args.skill),
      revision: text.revision,
      hash: text.hash,
    },
  }
}
