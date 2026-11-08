import type { ECommandGroup, ECommandTiming } from '@dltech/atlas-core'
import type { z } from 'zod'

export type CommandSpec = {
  name: string
  summary: string
  group: ECommandGroup
  args: z.ZodType
  timing: ECommandTiming
  handledIn: 'pod' | 'control'
}
