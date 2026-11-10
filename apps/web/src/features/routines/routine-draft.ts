import type { Routine } from '@dltech/atlas-protocol'

export interface RoutineDraft {
  projectId: string
  name: string
  prompt: string
  cron: string
  timezone: string
  model: string
}

export const DEFAULT_CRON = '0 7 * * 1-5'

export const resolvedTimeZone = (): string => {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return zone.length === 0 ? 'UTC' : zone
}

export const draftOf = (routine: Routine | undefined, projectId: string): RoutineDraft =>
  routine === undefined
    ? {
        projectId,
        name: '',
        prompt: '',
        cron: DEFAULT_CRON,
        timezone: resolvedTimeZone(),
        model: '',
      }
    : {
        projectId: routine.projectId,
        name: routine.name,
        prompt: routine.prompt,
        cron: routine.cron,
        timezone: routine.timezone,
        model: routine.model ?? '',
      }
