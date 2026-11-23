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

import { catalogueOf } from './catalogue-source'
import type { BuiltInFile } from './builtin-files'
import { textOf } from './daemon'
import type { CloudSkillBody } from './port'
import type { SkillsPodOptions } from './resources'
import {
  entryPathOf,
  isBuiltInSkill,
  isCloudSkill,
  isRepoSkill,
  loadSkillBodyOf,
  SKILLS_UNREADABLE_REASON,
  unknownReason,
} from './skill-body'
import type { CatalogueSkill, CloudCatalogueSkill } from './types'

const isBinaryFile = (file: BuiltInFile): file is { path: string; binary: string } =>
  'binary' in file

const inputSchema = z.strictObject({
  name: z.string().min(1),
  arguments: z.string().optional(),
  path: z.string().min(1).optional(),
})

const description = [
  'Load a skill: a packaged set of instructions for one kind of work, which becomes your procedure for it.',
  'Call it whenever a skill listed in your system prompt covers the task in front of you, before you plan an approach of your own. The packaged instructions know things about this project directory that you cannot infer.',
  'Pass name exactly as the listing spells it, and arguments only when the task has a subject the skill should be pointed at. Most skills need none.',
  'Pass path to read one file a skill bundles: the path is relative to the skill\u2019s own directory.',
].join(' ')

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
    private readonly options: SkillsPodOptions,
  ) {
    super()
  }

  protected override async run({
    input,
    projectDirectory,
  }: ToolRun<typeof inputSchema>): Promise<ToolOutcome> {
    const catalogue = await catalogueOf({
      ctx: this.ctx,
      options: this.options,
      directory: projectDirectory,
    })
    if (catalogue === null) return { ok: false, reason: SKILLS_UNREADABLE_REASON }

    const requested = input.name.trim().toLowerCase()
    const found = catalogue.skills.find((skill) => skill.name === requested)
    if (found === undefined) return { ok: false, reason: unknownReason({ requested, catalogue }) }

    if (!found.modelInvocable)
      return {
        ok: false,
        reason: `the ${found.name} skill sets disable-model-invocation, so only the operator can load it`,
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

    const binary = isBuiltInSkill(args.skill)
      ? args.skill.files.find(
          (file) => isBinaryFile(file) && file.path.toLowerCase() === args.path.toLowerCase(),
        )
      : undefined
    if (binary !== undefined && isBinaryFile(binary))
      return {
        ok: false,
        reason: `"${args.path}" is a ${binary.binary} file in the ${args.skill.name} skill, so it cannot be read as text`,
      }

    const bundled = await this.bundledText({ skill: args.skill, path: args.path })
    if (bundled === null)
      return {
        ok: false,
        reason: `the ${args.skill.name} skill bundles no readable file at "${args.path}"`,
      }
    return {
      ok: true,
      output: {
        name: args.skill.name,
        path: args.path,
        text: bundled.text,
        revision: bundled.revision,
        hash: bundled.hash,
      },
      modelText: bundled.text,
    }
  }

  private async bundledText(args: {
    skill: CatalogueSkill
    path: string
  }): Promise<CloudSkillBody | null> {
    if (isCloudSkill(args.skill)) {
      const cloud = this.options.cloud(this.ctx)
      return await cloud.file(cloudEntryOf(args.skill), args.path)
    }
    if (isBuiltInSkill(args.skill)) {
      const found = args.skill.files.find(
        (file) => !isBinaryFile(file) && file.path.toLowerCase() === args.path.toLowerCase(),
      )
      return found === undefined || isBinaryFile(found)
        ? null
        : { text: found.text, revision: 0, hash: '' }
    }
    if (!isRepoSkill(args.skill)) return null

    const read = await textOf({ ctx: this.ctx, path: join(args.skill.directory, args.path) })
    return read.ok ? { text: read.value, revision: 0, hash: '' } : null
  }

  private async loadBody(args: {
    skill: CatalogueSkill
    arguments: string | undefined
  }): Promise<ToolOutcome> {
    const argumentText = args.arguments?.trim() ?? ''
    const loaded = await loadSkillBodyOf({
      ctx: this.ctx,
      options: this.options,
      skill: args.skill,
      argumentText,
    })
    if (!loaded.ok) return { ok: false, reason: loaded.reason }

    const { body, note, revision, hash } = loaded.loaded
    return {
      ok: true,
      output: {
        name: args.skill.name,
        directory: args.skill.directory,
        path: entryPathOf(args.skill),
        text: body,
        argumentText,
        revision,
        hash,
      },
      modelText: note === '' ? body : `${note}\n\n${body}`,
    }
  }
}
