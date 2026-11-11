import type { Routine } from '@dltech/atlas-protocol'
import { parseScheduleText } from '@dltech/atlas-schedule'

import {
  effortOfName,
  UNSET_SELECTION,
  type ModelSelection,
} from '@/features/threads/data/model-selection'

import { cronOf, scheduleSummaryOf } from './routine-schedule'
import { cronOfFields, DEFAULT_SCHEDULE_FIELDS } from './routine-schedule-fields'

export interface RoutineDraft {
  projectId: string
  name: string
  prompt: string
  when: string
  cron: string | null
  timezone: string
  selection: ModelSelection
}

export type DraftSchedule = { ok: true; cron: string } | { ok: false; reason: string }

export const NEW_ROUTINE_WHEN = scheduleSummaryOf(cronOfFields(DEFAULT_SCHEDULE_FIELDS))

export const draftOf = (
  routine: Routine | undefined,
  args: { projectId: string; defaultTimezone: string },
): RoutineDraft =>
  routine === undefined
    ? {
        projectId: args.projectId,
        name: '',
        prompt: '',
        when: NEW_ROUTINE_WHEN,
        cron: null,
        timezone: args.defaultTimezone,
        selection: UNSET_SELECTION,
      }
    : {
        projectId: routine.projectId,
        name: routine.name,
        prompt: routine.prompt,
        when: scheduleSummaryOf(routine.cron),
        cron: cronOf(routine.cron) === null ? null : routine.cron,
        timezone: routine.timezone,
        selection:
          routine.model === null
            ? UNSET_SELECTION
            : {
                id: routine.model,
                effort: effortOfName(routine.effort ?? undefined),
                fast: routine.fast === true,
              },
      }

export const scheduleOfDraft = (draft: RoutineDraft): DraftSchedule => {
  if (draft.cron !== null && draft.when === scheduleSummaryOf(draft.cron)) {
    return { ok: true, cron: draft.cron }
  }
  const parsed = parseScheduleText(draft.when)
  return parsed.ok ? { ok: true, cron: parsed.cron.expression } : parsed
}

export const modelPatchOf = (
  selection: ModelSelection,
): { model: string | null; effort: string | null; fast: boolean | null } =>
  selection.id === ''
    ? { model: null, effort: null, fast: null }
    : { model: selection.id, effort: selection.effort, fast: selection.fast }
