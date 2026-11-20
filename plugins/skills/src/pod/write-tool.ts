import {
  EToolEffect,
  SchemaTool,
  TOUCHES_PATHS_IT_CANNOT_NAME,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'

import type { SkillsPodOptions } from './hooks'
import type { SkillsPodState } from './state'
import { deleteSkill, editSkill, installSkill } from './write-actions'
import { ESkillAction, requiredRefusal, skillManageSchema } from './write-support'

const description = [
  'Manage one installed skill: install it, replace one of its files, or delete it.',
  'action install writes a whole SKILL.md, frontmatter and all. action edit replaces one file. action delete removes the skill from one layer.',
  'layer is user, project or repo. user covers every project of the operator. project covers this repository. repo writes <repo>/.agents/skills/<name>/SKILL.md in the clone this session works in.',
  'name is the folder the skill lives in, lowercase. body is the whole text of the file. Write the frontmatter as strict YAML and double-quote any value that contains ": ".',
  'action edit writes SKILL.md, or the file named by path inside the skill directory. A cloud edit needs baseRevision, the revision the body it replaces was at. The skill tool reports that revision when it loads the skill. A stale revision is refused with the current revision and hash, so the edit is not lost; read the skill again and retry. layer repo needs no revision.',
  'install refuses a cloud skill that already exists rather than overwriting it.',
  'A built-in skill ships compiled into Atlas, so it cannot be deleted.',
  'install and edit need layer, name and body. delete needs layer and name.',
].join(' ')

export class SkillManageTool extends SchemaTool<typeof skillManageSchema> {
  readonly name = 'skill_manage'
  readonly description = description
  readonly effect = EToolEffect.Write
  readonly inputSchema = skillManageSchema
  override readonly pathFields = TOUCHES_PATHS_IT_CANNOT_NAME

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
  }: ToolRun<typeof skillManageSchema>): Promise<ToolOutcome> {
    const { name, layer } = input
    if (name === undefined || layer === undefined) return requiredRefusal(input.action)

    const deps = {
      ctx: this.ctx,
      state: this.state,
      options: this.options,
      projectDirectory,
    }

    if (input.action === ESkillAction.Delete)
      return await deleteSkill({ ...deps, input: { name, layer } })

    if (input.body === undefined) return requiredRefusal(input.action)

    if (input.action === ESkillAction.Edit)
      return await editSkill({
        ...deps,
        input: {
          name,
          layer,
          body: input.body,
          ...(input.path === undefined ? {} : { path: input.path }),
          ...(input.baseRevision === undefined ? {} : { baseRevision: input.baseRevision }),
        },
      })

    return await installSkill({ ...deps, input: { name, layer, body: input.body } })
  }
}
