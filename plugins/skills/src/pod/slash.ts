import { EContextSlot, type EventDraft } from '@dltech/atlas-core'
import type { PluginPodContext, PodSlash } from '@dltech/atlas-plugin-sdk'

import type { SkillCatalogue } from './catalogue'
import { catalogueOf } from './catalogue-source'
import type { SkillsPodOptions } from './resources'
import { loadSkillBodyOf, SKILLS_UNREADABLE_REASON, unknownReason } from './skill-body'

const catalogueFor = async (args: {
  ctx: PluginPodContext
  options: SkillsPodOptions
  directory?: string | undefined
}): Promise<SkillCatalogue | null> => {
  const recorded = await catalogueOf({ ctx: args.ctx, options: args.options })
  if (recorded !== null) return recorded
  return await catalogueOf({
    ctx: args.ctx,
    options: args.options,
    directory: args.directory ?? args.ctx.workspaceDirectory ?? undefined,
  })
}

const namesOf = async (args: {
  ctx: PluginPodContext
  options: SkillsPodOptions
  directory?: string | undefined
}): Promise<readonly string[]> => {
  const catalogue = await catalogueFor(args)
  if (catalogue === null) return []
  return catalogue.skills.filter((skill) => skill.userInvocable).map((skill) => skill.name)
}

export const skillsSlashOf = (args: {
  ctx: PluginPodContext
  options: SkillsPodOptions
  directory?: string | undefined
}): PodSlash => ({
  names: async () => await namesOf(args),
  load: async ({ name, argumentText }) => {
    const catalogue = await catalogueFor(args)
    if (catalogue === null) return { ok: false, reason: SKILLS_UNREADABLE_REASON }

    const requested = name.trim().toLowerCase()
    const found = catalogue.skills.find((skill) => skill.name === requested)
    if (found === undefined) return { ok: false, reason: unknownReason({ requested, catalogue }) }

    const loaded = await loadSkillBodyOf({
      ctx: args.ctx,
      options: args.options,
      skill: found,
      argumentText,
    })
    if (!loaded.ok) return { ok: false, reason: loaded.reason }

    const { body, note } = loaded.loaded
    const content = note === '' ? body : `${note}\n\n${body}`
    const drafts: readonly EventDraft[] = [
      { type: 'context-loaded', slot: EContextSlot.Skill, key: found.name, content },
    ]
    return { ok: true, drafts }
  },
})
