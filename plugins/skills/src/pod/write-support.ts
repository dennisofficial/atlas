import type { ToolOutcome } from '@dltech/atlas-core'
import { z } from 'zod'

import { ESkillOrigin, frontmatterOf, SKILL_NAME_MAX_LENGTH, skillFrontmatterOf } from '../core'
import type { SkillCatalogue } from './catalogue'
import { BUILT_IN_SKILLS } from './builtin.generated'
import type { CloudSkillRevision, CloudSkillWriteResult, SkillScopeName } from './port'
import { SKILL_ENTRY_PATH } from './repo-writes'

export enum ESkillWriteLayer {
  User = 'user',
  Project = 'project',
  Repo = 'repo',
}

const installSchema = z.strictObject({
  layer: z.enum(ESkillWriteLayer),
  name: z.string().min(1),
  body: z.string().min(1),
})

const editSchema = z.strictObject({
  name: z.string().min(1),
  layer: z.enum(ESkillWriteLayer),
  path: z.string().min(1).optional(),
  body: z.string().min(1),
  baseRevision: z.number().int().min(0).optional(),
})

const deleteSchema = z.strictObject({
  name: z.string().min(1),
  layer: z.enum(ESkillWriteLayer),
})

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/

export const BUILT_IN_SKILL_NAMES: readonly string[] = BUILT_IN_SKILLS.map((skill) => skill.name)

const builtInNames = new Set(BUILT_IN_SKILL_NAMES)

export const isBuiltInSkillName = (name: string): boolean => builtInNames.has(name)

const NO_CLOUD = 'this session cannot write cloud skills'

const scopeOf = (layer: ESkillWriteLayer): SkillScopeName | null =>
  layer === ESkillWriteLayer.User ? 'user' : layer === ESkillWriteLayer.Project ? 'project' : null

const nameProblem = (name: string): string | undefined => {
  if (name === '') return 'a skill needs a name'
  if (!NAME_PATTERN.test(name) || name.length > SKILL_NAME_MAX_LENGTH)
    return `a skill name must match ${NAME_PATTERN.source} and be at most ${SKILL_NAME_MAX_LENGTH} characters, so "${name}" will not do`
  return undefined
}

const pathProblem = (path: string): string | undefined =>
  path === '' ||
  path.startsWith('/') ||
  path.split('/').some((part) => part === '..' || part === '')
    ? `"${path}" is not a path inside the skill directory`
    : undefined

const LAYER_OF_ORIGIN: Readonly<Partial<Record<ESkillOrigin, ESkillWriteLayer>>> = {
  [ESkillOrigin.Repo]: ESkillWriteLayer.Repo,
  [ESkillOrigin.CloudUser]: ESkillWriteLayer.User,
  [ESkillOrigin.CloudProject]: ESkillWriteLayer.Project,
}

const repoDirectoryOf = (skill: SkillCatalogue['skills'][number]): string | null =>
  'directory' in skill && skill.directory !== null ? skill.directory : null

export const elsewhereOf = (args: {
  catalogue: SkillCatalogue | null
  name: string
  layer: ESkillWriteLayer
}): string | undefined => {
  const kept = args.catalogue?.skills.find((skill) => skill.name === args.name)
  if (kept === undefined) return undefined
  const home = LAYER_OF_ORIGIN[kept.origin]
  if (home === undefined || home === args.layer) return undefined
  if (home === ESkillWriteLayer.Repo) {
    const directory = repoDirectoryOf(kept)
    return `the ${args.name} skill is loaded from the repo${directory === null ? '' : ` at ${directory}`}, so this session reads that copy; call this with layer repo to change the one you loaded`
  }
  return `the ${args.name} skill lives in the cloud ${home} layer; call this with layer ${home}`
}

export const builtInRefusal = (name: string): string =>
  `the ${name} skill ships compiled into Atlas, so a second copy of it cannot be installed, edited or deleted; call it by name instead`

const descriptionOf = (args: { body: string; name: string; path: string }): string | null =>
  args.path.toLowerCase() === SKILL_ENTRY_PATH.toLowerCase()
    ? skillFrontmatterOf({ fields: frontmatterOf(args.body), fallbackName: args.name }).description
    : null

type CloudSkillRefusal = Extract<CloudSkillWriteResult, { ok: false }>

const refused = (result: CloudSkillRefusal, name: string): ToolOutcome => {
  const current: CloudSkillRevision | null = result.current
  if (current === null) return { ok: false, reason: result.reason }
  return {
    ok: false,
    reason: `${result.reason}; the ${name} skill is at revision ${current.revision} with hash ${current.hash}, so read it again and retry with that baseRevision`,
  }
}

const cloudMissing = (): ToolOutcome => ({ ok: false, reason: NO_CLOUD })
export {
  cloudMissing,
  deleteSchema,
  descriptionOf,
  editSchema,
  installSchema,
  nameProblem,
  pathProblem,
  refused,
  scopeOf,
}
