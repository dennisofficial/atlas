import type { CommandHandler, CommandResult } from '@dltech/atlas-commands'
import {
  EResumeOutcome,
  EResumePoint,
  RESUME_REFUSAL_NOTHING,
  RESUME_REFUSAL_RUNNING,
  resumeMarkedDraft,
  resumePointOf,
  type EventDraft,
  type ResumePoint,
} from '@dltech/atlas-core'

import { REFUSAL_RESUME_TEXT, resumeArgs } from './spec'

export { resumeMarkedDraft, type ResumablePoint } from '@dltech/atlas-core'

export const REFUSAL_RESUME_AGENT = 'No sub-agent with that id in this session.'

export async function resumeNow(args: {
  point: ResumePoint
  inboxId?: number | undefined
  append(drafts: readonly EventDraft[]): Promise<void>
}): Promise<CommandResult> {
  if (args.point.kind === EResumePoint.NotResumable) {
    return { kind: 'refused', reason: args.point.because }
  }
  await args.append([resumeMarkedDraft({ point: args.point, inboxId: args.inboxId })])
  return { kind: 'done' }
}

const childResultOf = (outcome: EResumeOutcome): CommandResult => {
  switch (outcome) {
    case EResumeOutcome.Resumed:
      return { kind: 'done' }
    case EResumeOutcome.UnknownAgent:
      return { kind: 'refused', reason: REFUSAL_RESUME_AGENT }
    case EResumeOutcome.Running:
      return { kind: 'refused', reason: RESUME_REFUSAL_RUNNING }
    case EResumeOutcome.NotResumable:
      return { kind: 'refused', reason: RESUME_REFUSAL_NOTHING }
  }
}

export const resumeHandler: CommandHandler<unknown> = async (context) => {
  const parsed = resumeArgs.safeParse(context.args)
  if (!parsed.success) return { kind: 'refused', reason: REFUSAL_RESUME_TEXT }
  const { agentId } = parsed.data
  if (agentId !== undefined && agentId !== context.mainThreadId) {
    const outcome =
      context.crew === undefined
        ? EResumeOutcome.UnknownAgent
        : await context.crew.resume({ agentId })
    return childResultOf(outcome)
  }
  return await resumeNow({
    point: resumePointOf({ events: context.logEvents() }),
    inboxId: context.inboxId,
    append: context.append,
  })
}
