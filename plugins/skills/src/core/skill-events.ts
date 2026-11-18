import { z } from 'zod'

import { ESkillOrigin } from './spec'

export type SkillListRow = {
  name: string
  description: string
  argumentHint: string | null
  origin: ESkillOrigin
}

export type SkillsChanged = { type: 'skills-changed'; skills: readonly SkillListRow[] }

declare module '@dltech/atlas-core' {
  interface PluginEventBodies {
    'skills-changed': SkillsChanged
  }
}

export const skillListRowSchema: z.ZodType<SkillListRow> = z.object({
  name: z.string().min(1),
  description: z.string(),
  argumentHint: z.string().nullable(),
  origin: z.enum(ESkillOrigin),
})

export const skillsChangedSchema: z.ZodType<SkillsChanged> = z.object({
  type: z.literal('skills-changed'),
  skills: z.array(skillListRowSchema),
})
