import { EEffort, EFFORT_LADDER, parseRef, refKey } from '@dltech/atlas-core'
import type { SessionModelChoice } from '@dltech/atlas-protocol'

import type { SwitcherChoice } from '../ui/switcher-model'
import type { SessionApi } from './session-api'

export type ModelSetArgs = { model: string; effort?: string; fast?: boolean }

export const effortOf = (name: string): EEffort =>
  EFFORT_LADDER.find((effort) => effort === name) ?? EEffort.Medium

export const modelSetArgsOf = (args: { choice: SwitcherChoice }): ModelSetArgs | null => {
  const { ref } = args.choice
  if (ref === null) return null

  return {
    model: refKey(ref),
    effort: args.choice.effort,
    ...(args.choice.fast ? { fast: true } : {}),
  }
}

export const choiceOfModel = (args: { model: SessionModelChoice }): SwitcherChoice => ({
  ref: parseRef(args.model.ref) ?? null,
  effort: effortOf(args.model.effort),
  fast: args.model.fast,
})

export const applyModelSet = async (args: {
  api: Pick<SessionApi, 'runCommand'>
  sessionId: string
  choice: SwitcherChoice
}): Promise<void> => {
  const modelArgs = modelSetArgsOf({ choice: args.choice })
  if (modelArgs === null) return

  await args.api.runCommand({ sessionId: args.sessionId, name: 'model-set', args: modelArgs })
}
