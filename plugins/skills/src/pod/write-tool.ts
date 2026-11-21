import {
  EToolEffect,
  SchemaTool,
  TOUCHES_PATHS_IT_CANNOT_NAME,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { ESkillOrigin } from '../core'
import { catalogueOf } from './catalogue-source'
import type { SkillsPodOptions } from './resources'
import {
  hasClone,
  removeRepoSkillDirectory,
  repoSkillDirectoryOf,
  SKILL_ENTRY_PATH,
  writeRepoSkillFile,
} from './repo-writes'
import { SKILLS_RESOURCE } from './resources'
import {
  builtInRefusal,
  isBuiltInSkillName,
  cloudMissing,
  deleteSchema,
  elsewhereOf,
  descriptionOf,
  editSchema,
  installSchema,
  nameProblem,
  pathProblem,
  refused,
  scopeOf,
} from './write-support'

export class SkillInstallTool extends SchemaTool<typeof installSchema> {
  readonly name = 'skill_install'
  readonly effect = EToolEffect.Write
  readonly inputSchema = installSchema
  override readonly pathFields = TOUCHES_PATHS_IT_CANNOT_NAME
  readonly description = [
    'Install a skill by writing its whole SKILL.md, frontmatter and all, under one layer: the shape for "install the X skill", where you drop the body yourself.',
    'layer user installs it for every project of the operator. layer project installs it for this project. layer repo writes <repo>/.agents/skills/<name>/SKILL.md into the clone this session works in.',
    'name is the folder the skill lives in, lowercase. body is the whole SKILL.md text. Write the frontmatter as strict YAML, double-quoting any value that contains ": ".',
    'Installing a cloud skill that already exists is refused rather than overwritten. Call skill_edit with the revision that skill reported.',
  ].join(' ')

  constructor(
    private readonly ctx: PluginPodContext,
    private readonly options: SkillsPodOptions,
  ) {
    super()
  }

  protected override async run({
    input,
    projectDirectory,
  }: ToolRun<typeof installSchema>): Promise<ToolOutcome> {
    const problem = nameProblem(input.name)
    if (problem !== undefined) return { ok: false, reason: problem }
    const scope = scopeOf(input.layer)
    if (scope !== null && isBuiltInSkillName(input.name))
      return { ok: false, reason: builtInRefusal(input.name) }

    if (scope === null) {
      const written = await writeRepoSkillFile({
        ctx: this.ctx,
        projectDirectory,
        name: input.name,
        path: SKILL_ENTRY_PATH,
        body: input.body,
      })
      if (!written.ok) return { ok: false, reason: written.reason }
      await this.ctx.resources.reload(SKILLS_RESOURCE)
      return {
        ok: true,
        output: { name: input.name, layer: input.layer, path: written.path },
        modelText: `the ${input.name} skill is installed at ${written.path}`,
      }
    }

    const writes = this.options.writes?.(this.ctx)
    if (writes === undefined) return cloudMissing()
    const elsewhere = elsewhereOf({
      catalogue: await catalogueOf({
        ctx: this.ctx,
        options: this.options,
        directory: projectDirectory,
      }),
      name: input.name,
      layer: input.layer,
    })
    if (elsewhere !== undefined) return { ok: false, reason: elsewhere }
    const result = await writes.write({
      scope,
      name: input.name,
      path: SKILL_ENTRY_PATH,
      body: input.body,
      description: descriptionOf({ body: input.body, name: input.name, path: SKILL_ENTRY_PATH }),
      baseRevision: 0,
    })
    if (!result.ok) return refused(result, input.name)
    await this.ctx.resources.reload(SKILLS_RESOURCE)
    return {
      ok: true,
      output: { name: input.name, layer: input.layer, revision: result.revision },
      modelText: `the ${input.name} skill is installed in the cloud ${scope} layer at revision ${result.revision}`,
    }
  }
}

export class SkillEditTool extends SchemaTool<typeof editSchema> {
  readonly name = 'skill_edit'
  readonly effect = EToolEffect.Write
  readonly inputSchema = editSchema
  override readonly pathFields = TOUCHES_PATHS_IT_CANNOT_NAME
  readonly description = [
    'Replace one file of an installed skill whole: SKILL.md by default, or the file named by path inside the skill directory.',
    'A cloud edit must carry baseRevision, the revision the body it replaces was at. skill reports that revision when it loads the skill. An edit whose revision is stale is refused with the current revision and hash, so the edit is not lost. Read the skill again and retry.',
    'layer repo writes into <repo>/.agents/skills/<name>/ in this session\u2019s clone and needs no revision.',
  ].join(' ')

  constructor(
    private readonly ctx: PluginPodContext,
    private readonly options: SkillsPodOptions,
  ) {
    super()
  }

  protected override async run({
    input,
    projectDirectory,
  }: ToolRun<typeof editSchema>): Promise<ToolOutcome> {
    const problem = nameProblem(input.name)
    if (problem !== undefined) return { ok: false, reason: problem }
    const path = input.path ?? SKILL_ENTRY_PATH
    const badPath = pathProblem(path)
    if (badPath !== undefined) return { ok: false, reason: badPath }
    const scope = scopeOf(input.layer)
    if (scope !== null && isBuiltInSkillName(input.name))
      return { ok: false, reason: builtInRefusal(input.name) }

    if (scope === null) {
      const catalogue = await catalogueOf({
        ctx: this.ctx,
        options: this.options,
        directory: projectDirectory,
      })
      const elsewhere = elsewhereOf({ catalogue, name: input.name, layer: input.layer })
      if (elsewhere !== undefined) return { ok: false, reason: elsewhere }
      const found = catalogue?.skills.find(
        (skill) => skill.name === input.name && skill.origin === ESkillOrigin.Repo,
      )
      if (catalogue !== null && found === undefined)
        return {
          ok: false,
          reason: `no repo skill is named ${input.name}; call skill_install with layer repo to create it`,
        }
      const written = await writeRepoSkillFile({
        ctx: this.ctx,
        projectDirectory,
        name: input.name,
        path,
        body: input.body,
      })
      if (!written.ok) return { ok: false, reason: written.reason }
      await this.ctx.resources.reload(SKILLS_RESOURCE)
      return {
        ok: true,
        output: { name: input.name, layer: input.layer, path: written.path },
        modelText: `the ${input.name} skill is updated at ${written.path}`,
      }
    }

    const writes = this.options.writes?.(this.ctx)
    if (writes === undefined) return cloudMissing()
    const elsewhere = elsewhereOf({
      catalogue: await catalogueOf({
        ctx: this.ctx,
        options: this.options,
        directory: projectDirectory,
      }),
      name: input.name,
      layer: input.layer,
    })
    if (elsewhere !== undefined) return { ok: false, reason: elsewhere }
    const result = await writes.write({
      scope,
      name: input.name,
      path,
      body: input.body,
      description: descriptionOf({ body: input.body, name: input.name, path }),
      baseRevision: input.baseRevision ?? null,
    })
    if (!result.ok) return refused(result, input.name)
    await this.ctx.resources.reload(SKILLS_RESOURCE)
    return {
      ok: true,
      output: { name: input.name, layer: input.layer, revision: result.revision },
      modelText: `the ${input.name} skill is updated in the cloud ${scope} layer, now at revision ${result.revision}`,
    }
  }
}

export class SkillDeleteTool extends SchemaTool<typeof deleteSchema> {
  readonly name = 'skill_delete'
  readonly effect = EToolEffect.Destructive
  readonly inputSchema = deleteSchema
  override readonly pathFields = TOUCHES_PATHS_IT_CANNOT_NAME
  readonly description = [
    'Delete a whole skill from one layer: a cloud skill with every file it bundles, or the directory of a repo skill in this session\u2019s clone.',
    'A built-in skill cannot be deleted, because it ships compiled into Atlas.',
  ].join(' ')

  constructor(
    private readonly ctx: PluginPodContext,
    private readonly options: SkillsPodOptions,
  ) {
    super()
  }

  protected override async run({
    input,
    projectDirectory,
  }: ToolRun<typeof deleteSchema>): Promise<ToolOutcome> {
    const problem = nameProblem(input.name)
    if (problem !== undefined) return { ok: false, reason: problem }
    const scope = scopeOf(input.layer)
    if (scope !== null && isBuiltInSkillName(input.name))
      return { ok: false, reason: builtInRefusal(input.name) }

    if (scope === null) {
      if (!(await hasClone({ ctx: this.ctx, projectDirectory })))
        return {
          ok: false,
          reason:
            'this session has no clone, so it has no <repo>/.agents/skills directory to delete from. Use layer user or layer project instead',
        }
      const catalogue = await catalogueOf({
        ctx: this.ctx,
        options: this.options,
        directory: projectDirectory,
      })
      const elsewhere = elsewhereOf({ catalogue, name: input.name, layer: input.layer })
      if (elsewhere !== undefined) return { ok: false, reason: elsewhere }
      const found = catalogue?.skills.find(
        (skill) => skill.name === input.name && skill.origin === ESkillOrigin.Repo,
      )
      if (catalogue === null || found === undefined)
        return { ok: false, reason: `no repo skill is named ${input.name}` }

      const removed = await removeRepoSkillDirectory({
        ctx: this.ctx,
        projectDirectory,
        directory: repoSkillDirectoryOf({ projectDirectory, name: input.name }),
      })
      if (!removed.ok) return { ok: false, reason: removed.reason }
      await this.ctx.resources.reload(SKILLS_RESOURCE)
      return {
        ok: true,
        output: { name: input.name, layer: input.layer, path: removed.path },
        modelText: `the ${input.name} skill is deleted from ${removed.path}`,
      }
    }

    const writes = this.options.writes?.(this.ctx)
    if (writes === undefined) return cloudMissing()
    const elsewhere = elsewhereOf({
      catalogue: await catalogueOf({
        ctx: this.ctx,
        options: this.options,
        directory: projectDirectory,
      }),
      name: input.name,
      layer: input.layer,
    })
    if (elsewhere !== undefined) return { ok: false, reason: elsewhere }
    const result = await writes.remove({ scope, name: input.name })
    if (!result.ok) return { ok: false, reason: result.reason }
    await this.ctx.resources.reload(SKILLS_RESOURCE)
    return {
      ok: true,
      output: { name: input.name, layer: input.layer },
      modelText: `the ${input.name} skill and every file it bundled are deleted from the cloud ${scope} layer`,
    }
  }
}
