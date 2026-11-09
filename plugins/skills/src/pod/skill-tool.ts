import { isAbsolute, join } from 'node:path'

import {
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { z } from 'zod'

import { ESkillOrigin, expandSkillBody, skillBodyOf } from '../core'
import type { SkillCatalogue } from './catalogue'
import { catalogueFor } from './catalogue-source'
import { textOf } from './daemon'
import type { SkillsPodOptions } from './hooks'
import type { SkillsPodState } from './state'
import type {
  BuiltInCatalogueSkill,
  CatalogueSkill,
  CloudCatalogueSkill,
  RepoCatalogueSkill,
} from './types'

const isRepoSkill = (skill: CatalogueSkill): skill is RepoCatalogueSkill => 'entryPath' in skill

const isBuiltInSkill = (skill: CatalogueSkill): skill is BuiltInCatalogueSkill => 'text' in skill

const isCloudSkill = (skill: CatalogueSkill): skill is CloudCatalogueSkill =>
  skill.origin === ESkillOrigin.CloudUser || skill.origin === ESkillOrigin.CloudProject

const SUGGESTION_LIMIT = 3

const inputSchema = z.strictObject({
  name: z.string().min(1),
  arguments: z.string().optional(),
  path: z.string().min(1).optional(),
})

const description = [
  'Load a skill: a packaged set of instructions someone already wrote for one kind of work, which becomes your procedure for it.',
  'Call this whenever a skill listed in your system prompt covers the task in front of you, and call it before planning an approach of your own, because the packaged instructions know things about this workspace that you cannot infer.',
  'Pass name exactly as the listing spells it. Pass arguments only when the task has a subject the skill should be pointed at; most skills need none.',
  'Pass path to read one file a skill bundles: the path is relative to the skill\u2019s own directory.',
].join(' ')

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

const unknownReason = (args: { requested: string; catalogue: SkillCatalogue }): string => {
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
    : `The ${skill.name} skill is installed at ${skill.directory}. Every relative path below names a file inside that directory, so read one by joining it onto that path rather than onto the project directory.`

const bundlesFiles = (skill: CatalogueSkill): boolean =>
  isCloudSkill(skill) || (isBuiltInSkill(skill) && skill.files.length > 0)

const bundledNoteOf = (skill: CatalogueSkill): string =>
  bundlesFiles(skill)
    ? `The ${skill.name} skill has no directory in this session: read a file it bundles by calling this tool again with path set to that file's path.`
    : ''

const noteOf = (skill: CatalogueSkill): string => directoryNoteOf(skill) || bundledNoteOf(skill)

const entryPathOf = (skill: CatalogueSkill): string | null =>
  isRepoSkill(skill) ? skill.entryPath : null

const isInsideDirectory = (path: string): boolean =>
  !isAbsolute(path) && path.split('/').every((segment) => segment !== '..')

const cloudEntryOf = (skill: CloudCatalogueSkill) => ({
  name: skill.name,
  description: skill.description,
  scope: skill.scope,
})

export class SkillTool extends SchemaTool<typeof inputSchema> {
  readonly name = 'skill'
  readonly description = description
  readonly effect = EToolEffect.Read
  override readonly isConcurrencySafe = (): boolean => true
  readonly inputSchema = inputSchema
  override readonly pathFields = TAKES_NO_PATHS

  constructor(
    private readonly ctx: PluginPodContext,
    private readonly state: SkillsPodState,
    private readonly options: SkillsPodOptions,
  ) {
    super()
  }

  protected override async run({
    input,
    projectDirectory,
  }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    const catalogue = await catalogueFor({
      ctx: this.ctx,
      state: this.state,
      cloud: this.options.cloud,
      directory: projectDirectory,
    })
    if (catalogue === null)
      return { ok: false, reason: 'the skills could not be read in this session' }

    const requested = input.name.trim().toLowerCase()
    const found = catalogue.skills.find((skill) => skill.name === requested)
    if (found === undefined) return { ok: false, reason: unknownReason({ requested, catalogue }) }

    if (!found.modelInvocable)
      return {
        ok: false,
        reason: `the ${found.name} skill sets disable-model-invocation, so only the developer may reach for it`,
      }

    if (input.path !== undefined) return await this.readFile({ skill: found, path: input.path })
    return await this.loadBody({ skill: found, arguments: input.arguments })
  }

  private async readFile(args: { skill: CatalogueSkill; path: string }): Promise<ToolOutcome> {
    if (!isInsideDirectory(args.path))
      return {
        ok: false,
        reason: `"${args.path}" is not a path inside the ${args.skill.name} skill`,
      }

    const text = await this.bundledText({ skill: args.skill, path: args.path })
    if (text === null)
      return {
        ok: false,
        reason: `the ${args.skill.name} skill bundles no readable file at "${args.path}"`,
      }
    return {
      ok: true,
      output: { name: args.skill.name, path: args.path, text },
      modelText: text,
    }
  }

  private async bundledText(args: { skill: CatalogueSkill; path: string }): Promise<string | null> {
    if (isCloudSkill(args.skill))
      return await this.options.cloud.file(cloudEntryOf(args.skill), args.path)
    if (isBuiltInSkill(args.skill)) {
      const found = args.skill.files.find(
        (file) => file.path.toLowerCase() === args.path.toLowerCase(),
      )
      return found?.text ?? null
    }
    if (!isRepoSkill(args.skill)) return null

    const read = await textOf({ ctx: this.ctx, path: join(args.skill.directory, args.path) })
    return read.ok ? read.value : null
  }

  private async loadBody(args: {
    skill: CatalogueSkill
    arguments: string | undefined
  }): Promise<ToolOutcome> {
    const text = await this.skillText(args.skill)
    if (text === null)
      return { ok: false, reason: `the ${args.skill.name} skill's text could not be read` }

    const argumentText = args.arguments?.trim() ?? ''
    const body = expandSkillBody({ body: skillBodyOf(text), argumentText })
    const note = noteOf(args.skill)
    return {
      ok: true,
      output: {
        name: args.skill.name,
        directory: args.skill.directory,
        path: entryPathOf(args.skill),
        text: body,
        argumentText,
      },
      modelText: note === '' ? body : `${note}\n\n${body}`,
    }
  }

  private async skillText(skill: CatalogueSkill): Promise<string | null> {
    if (isBuiltInSkill(skill)) return skill.text
    if (isRepoSkill(skill)) {
      const read = await textOf({ ctx: this.ctx, path: skill.entryPath })
      return read.ok ? read.value : null
    }
    return await this.options.cloud.text(cloudEntryOf(skill))
  }
}
