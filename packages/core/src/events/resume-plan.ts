import type { EventDraft } from './body'
import type { Event, EventOfType } from './envelope'
import { awaitsReply, outstandingApproval, pendingCalls } from './projections'

export const RESUME_NUDGE =
  'You were interrupted mid-turn. Continue from exactly where you stopped: finish the thought you were in and carry on with the work. If a tool call was cut short, run it again. Do not restart, re-plan, or repeat what you already said, and do not ask what to do instead or remark on the interruption.'

const RESUME_LIFETIME_STEPS = 1

export const APPROVAL_WAITING =
  'an approval is waiting for an answer, so answer it rather than resuming past it'

export enum EResume {
  Continue = 'continue',
  Nudge = 'nudge',
  Blocked = 'blocked',
  Nothing = 'nothing',
}

export type ResumePlan =
  | { kind: EResume.Continue; nudge: boolean }
  | { kind: EResume.Nudge; interrupted: EventOfType<'assistant-said'> }
  | { kind: EResume.Blocked; reason: string }
  | { kind: EResume.Nothing }

export const carriesInterruption = (event: Event): boolean =>
  (event.type === 'assistant-said' ||
    event.type === 'tool-result' ||
    event.type === 'tool-denied') &&
  event.interrupted === true

function cutShortSincePrompt(events: readonly Event[]): boolean {
  const prompted = events.findLastIndex(
    (event) => event.type === 'user-said' || event.type === 'nudge',
  )
  return events.slice(prompted + 1).some(carriesInterruption)
}

export function resumePlan(events: readonly Event[]): ResumePlan {
  if (events.length === 0) return { kind: EResume.Nothing }

  if (outstandingApproval(events) !== undefined) {
    return { kind: EResume.Blocked, reason: APPROVAL_WAITING }
  }

  if (pendingCalls(events).length > 0) return { kind: EResume.Continue, nudge: false }
  if (awaitsReply(events)) return { kind: EResume.Continue, nudge: cutShortSincePrompt(events) }

  const spoke = events.findLast(
    (event): event is EventOfType<'assistant-said'> => event.type === 'assistant-said',
  )

  if (spoke?.interrupted !== true) return { kind: EResume.Nothing }
  return { kind: EResume.Nudge, interrupted: spoke }
}

const wantsNudge = (plan: ResumePlan): boolean =>
  plan.kind === EResume.Nudge || (plan.kind === EResume.Continue && plan.nudge)

export function nudgeDraftsFor(plan: ResumePlan): readonly EventDraft[] {
  if (!wantsNudge(plan)) return []
  return [{ type: 'nudge', text: RESUME_NUDGE, lifetimeSteps: RESUME_LIFETIME_STEPS }]
}

export const isResumablePlan = (plan: ResumePlan): boolean =>
  plan.kind === EResume.Continue || plan.kind === EResume.Nudge

export const resumeDrafts = (events: readonly Event[]): readonly EventDraft[] =>
  nudgeDraftsFor(resumePlan(events))

export const isResumable = (events: readonly Event[]): boolean =>
  isResumablePlan(resumePlan(events))
