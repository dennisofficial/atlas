import type { ToolOutcome } from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { ESkillOrigin } from '../core'
import { catalogueFor } from './catalogue-source'
import type { SkillsPodOptions } from './hooks'
import {
  hasClone,
  removeRepoSkillDirectory,
  repoSkillDirectoryOf,
  SKILL_ENTRY_PATH,
  writeRepoSkillFile,
} from './repo-writes'
import type { SkillsPodState } from './state'
import { forgetCatalogue } from './state'
import {
  builtInRefusal,
  cloudMissing,
  descriptionOf,
  elsewhereOf,
  isBuiltInSkillName,
  nameProblem,
  pathProblem,
  refused,
  scopeOf,
  type SkillEditInput,
  type SkillInstallInput,
  type SkillNameInput,
} from './write-support'

type ActionDeps = {
  ctx: PluginPodContext
  state: SkillsPodState
  options: SkillsPodOptions
  projectDirectory: string
}

export const installSkill = async (
  args: ActionDeps & { input: SkillInstallInput },
): Promise<ToolOutcome> => {
  const { input } = args
  const problem = nameProblem(input.name)
  if (problem !== undefined) return { ok: false, reason: problem }
  const scope = scopeOf(input.layer)
  if (scope !== null && isBuiltInSkillName(input.name))
    return { ok: false, reason: builtInRefusal(input.name) }

  if (scope === null) {
    const written = await writeRepoSkillFile({
      ctx: args.ctx,
      projectDirectory: args.projectDirectory,
      name: input.name,
      path: SKILL_ENTRY_PATH,
      body: input.body,
    })
    if (!written.ok) return { ok: false, reason: written.reason }
    forgetCatalogue(args.state)
    return {
      ok: true,
      output: { name: input.name, layer: input.layer, path: written.path },
      modelText: `the ${input.name} skill is installed at ${written.path}`,
    }
  }

  if (args.options.writes === undefined) return cloudMissing()
  const elsewhere = elsewhereOf({
    catalogue: await catalogueFor({
      ctx: args.ctx,
      state: args.state,
      cloud: args.options.cloud,
      directory: args.projectDirectory,
    }),
    name: input.name,
    layer: input.layer,
  })
  if (elsewhere !== undefined) return { ok: false, reason: elsewhere }
  const result = await args.options.writes.write({
    scope,
    name: input.name,
    path: SKILL_ENTRY_PATH,
    body: input.body,
    description: descriptionOf({ body: input.body, name: input.name, path: SKILL_ENTRY_PATH }),
    baseRevision: 0,
  })
  if (!result.ok) return refused(result, input.name)
  forgetCatalogue(args.state)
  return {
    ok: true,
    output: { name: input.name, layer: input.layer, revision: result.revision },
    modelText: `the ${input.name} skill is installed in the cloud ${scope} layer at revision ${result.revision}`,
  }
}

export const editSkill = async (
  args: ActionDeps & { input: SkillEditInput },
): Promise<ToolOutcome> => {
  const { input } = args
  const problem = nameProblem(input.name)
  if (problem !== undefined) return { ok: false, reason: problem }
  const path = input.path ?? SKILL_ENTRY_PATH
  const badPath = pathProblem(path)
  if (badPath !== undefined) return { ok: false, reason: badPath }
  const scope = scopeOf(input.layer)
  if (scope !== null && isBuiltInSkillName(input.name))
    return { ok: false, reason: builtInRefusal(input.name) }

  if (scope === null) {
    const catalogue = await catalogueFor({
      ctx: args.ctx,
      state: args.state,
      cloud: args.options.cloud,
      directory: args.projectDirectory,
    })
    const elsewhere = elsewhereOf({ catalogue, name: input.name, layer: input.layer })
    if (elsewhere !== undefined) return { ok: false, reason: elsewhere }
    const found = catalogue?.skills.find(
      (skill) => skill.name === input.name && skill.origin === ESkillOrigin.Repo,
    )
    if (catalogue !== null && found === undefined)
      return {
        ok: false,
        reason: `no repo skill is named ${input.name}; call skill_manage with action install and layer repo to create it`,
      }
    const written = await writeRepoSkillFile({
      ctx: args.ctx,
      projectDirectory: args.projectDirectory,
      name: input.name,
      path,
      body: input.body,
    })
    if (!written.ok) return { ok: false, reason: written.reason }
    forgetCatalogue(args.state)
    return {
      ok: true,
      output: { name: input.name, layer: input.layer, path: written.path },
      modelText: `the ${input.name} skill is updated at ${written.path}`,
    }
  }

  if (args.options.writes === undefined) return cloudMissing()
  const elsewhere = elsewhereOf({
    catalogue: await catalogueFor({
      ctx: args.ctx,
      state: args.state,
      cloud: args.options.cloud,
      directory: args.projectDirectory,
    }),
    name: input.name,
    layer: input.layer,
  })
  if (elsewhere !== undefined) return { ok: false, reason: elsewhere }
  const result = await args.options.writes.write({
    scope,
    name: input.name,
    path,
    body: input.body,
    description: descriptionOf({ body: input.body, name: input.name, path }),
    baseRevision: input.baseRevision ?? null,
  })
  if (!result.ok) return refused(result, input.name)
  forgetCatalogue(args.state)
  return {
    ok: true,
    output: { name: input.name, layer: input.layer, revision: result.revision },
    modelText: `the ${input.name} skill is updated in the cloud ${scope} layer, now at revision ${result.revision}`,
  }
}

export const deleteSkill = async (
  args: ActionDeps & { input: SkillNameInput },
): Promise<ToolOutcome> => {
  const { input } = args
  const problem = nameProblem(input.name)
  if (problem !== undefined) return { ok: false, reason: problem }
  const scope = scopeOf(input.layer)
  if (scope !== null && isBuiltInSkillName(input.name))
    return { ok: false, reason: builtInRefusal(input.name) }

  if (scope === null) {
    if (!(await hasClone({ ctx: args.ctx, projectDirectory: args.projectDirectory })))
      return {
        ok: false,
        reason:
          'this session has no clone, so it has no <repo>/.agents/skills directory to delete from. Use layer user or layer project instead',
      }
    const catalogue = await catalogueFor({
      ctx: args.ctx,
      state: args.state,
      cloud: args.options.cloud,
      directory: args.projectDirectory,
    })
    const elsewhere = elsewhereOf({ catalogue, name: input.name, layer: input.layer })
    if (elsewhere !== undefined) return { ok: false, reason: elsewhere }
    const found = catalogue?.skills.find(
      (skill) => skill.name === input.name && skill.origin === ESkillOrigin.Repo,
    )
    if (catalogue === null || found === undefined)
      return { ok: false, reason: `no repo skill is named ${input.name}` }

    const removed = await removeRepoSkillDirectory({
      ctx: args.ctx,
      projectDirectory: args.projectDirectory,
      directory: repoSkillDirectoryOf({
        projectDirectory: args.projectDirectory,
        name: input.name,
      }),
    })
    if (!removed.ok) return { ok: false, reason: removed.reason }
    forgetCatalogue(args.state)
    return {
      ok: true,
      output: { name: input.name, layer: input.layer, path: removed.path },
      modelText: `the ${input.name} skill is deleted from ${removed.path}`,
    }
  }

  if (args.options.writes === undefined) return cloudMissing()
  const elsewhere = elsewhereOf({
    catalogue: await catalogueFor({
      ctx: args.ctx,
      state: args.state,
      cloud: args.options.cloud,
      directory: args.projectDirectory,
    }),
    name: input.name,
    layer: input.layer,
  })
  if (elsewhere !== undefined) return { ok: false, reason: elsewhere }
  const result = await args.options.writes.remove({ scope, name: input.name })
  if (!result.ok) return { ok: false, reason: result.reason }
  forgetCatalogue(args.state)
  return {
    ok: true,
    output: { name: input.name, layer: input.layer },
    modelText: `the ${input.name} skill and every file it bundled are deleted from the cloud ${scope} layer`,
  }
}
