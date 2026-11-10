import type { Routine } from '@dltech/atlas-protocol'

import {
  effortOfName,
  UNSET_SELECTION,
  type ModelSelection,
} from '@/features/threads/data/model-selection'

import {
  cronOfFields,
  DEFAULT_SCHEDULE_FIELDS,
  fieldsOfCron,
  type ScheduleFields,
} from './routine-schedule-fields'
import { deviceTimezone } from './routine-timezones'

export interface RoutineDraft {
  projectId: string
  name: string
  prompt: string
  timezone: string
  schedule: ScheduleFields
  selection: ModelSelection
}

export const draftOf = (routine: Routine | undefined, projectId: string): RoutineDraft =>
  routine === undefined
    ? {
        projectId,
        name: '',
        prompt: '',
        timezone: deviceTimezone(),
        schedule: DEFAULT_SCHEDULE_FIELDS,
        selection: UNSET_SELECTION,
      }
    : {
        projectId: routine.projectId,
        name: routine.name,
        prompt: routine.prompt,
        timezone: routine.timezone,
        schedule: fieldsOfCron(routine.cron),
        selection:
          routine.model === null
            ? UNSET_SELECTION
            : {
                id: routine.model,
                effort: effortOfName(routine.effort ?? undefined),
                fast: routine.fast === true,
              },
      }

export const cronOfDraft = (draft: RoutineDraft): string => cronOfFields(draft.schedule)

export const modelPatchOf = (
  selection: ModelSelection,
): { model: string | null; effort: string | null; fast: boolean | null } =>
  selection.id === ''
    ? { model: null, effort: null, fast: null }
    : { model: selection.id, effort: selection.effort, fast: selection.fast }
