import { isTurnTaking } from '../agents/kind'
import type { EventDraft, EventType } from '../events/body'
import type { Event, EventOfType } from '../events/envelope'
import type { CallId } from '../events/ids'
import type { PendingCall } from '../events/projections'
import {
  APPROVAL_WAITING,
  carriesInterruption,
  EResume,
  isResumablePlan,
  nudgeDraftsFor,
  TOOL_PARKED_WAITING,
  type ResumePlan,
} from '../events/resume-plan'
import { type ActiveWorktree, activeWorktreeOf } from '../workspace/worktree'

export type LoopState = {
  empty: boolean
  lastSeq: number | undefined
  pending: readonly EventOfType<'tool-called'>[]
  dispatched: ReadonlySet<CallId>
  approvals: ReadonlyMap<CallId, number>
  parked: ReadonlyMap<CallId, number>
  lastTurnType: EventType | undefined
  lastAssistant: EventOfType<'assistant-said'> | undefined
  cutShortSincePrompt: boolean
  lastUserSaidSeq: number | undefined
  worktree: ActiveWorktree | undefined
  home: string | undefined
}

type Patch = Partial<LoopState>

export const initialLoopState = (): LoopState => ({
  empty: true,
  lastSeq: undefined,
  pending: [],
  dispatched: new Set(),
  approvals: new Map(),
  parked: new Map(),
  lastTurnType: undefined,
  lastAssistant: undefined,
  cutShortSincePrompt: false,
  lastUserSaidSeq: undefined,
  worktree: undefined,
  home: undefined,
})

const without = <TValue>({
  values,
  value,
}: {
  values: ReadonlySet<TValue>
  value: TValue
}): ReadonlySet<TValue> => {
  const next = new Set(values)
  next.delete(value)
  return next
}

const callsPatch = (state: LoopState, event: Event): Patch => {
  if (event.type === 'tool-called') {
    return {
      pending: [...state.pending, event],
      dispatched: state.dispatched.has(event.callId)
        ? without({ values: state.dispatched, value: event.callId })
        : state.dispatched,
    }
  }

  if (event.type === 'tool-dispatched') {
    const isPending = state.pending.some((call) => call.callId === event.callId)
    if (!isPending || state.dispatched.has(event.callId)) return {}
    return { dispatched: new Set(state.dispatched).add(event.callId) }
  }

  if (event.type !== 'tool-result' && event.type !== 'tool-denied') return {}

  const index = state.pending.findLastIndex((call) => call.callId === event.callId)
  if (index === -1) return {}

  const pending = [...state.pending.slice(0, index), ...state.pending.slice(index + 1)]
  const stillPending = pending.some((call) => call.callId === event.callId)
  if (stillPending || !state.dispatched.has(event.callId)) return { pending }
  return { pending, dispatched: without({ values: state.dispatched, value: event.callId }) }
}

const approvalsPatch = (state: LoopState, event: Event): Patch => {
  if (event.type === 'approval-requested') {
    return { approvals: new Map(state.approvals).set(event.callId, event.seq) }
  }
  if (event.type !== 'approval-answered' || !state.approvals.has(event.callId)) return {}

  const approvals = new Map(state.approvals)
  approvals.delete(event.callId)
  return { approvals }
}

const parkedPatch = (state: LoopState, event: Event): Patch => {
  if (event.type === 'tool-parked') {
    return { parked: new Map(state.parked).set(event.callId, event.seq) }
  }
  if (event.type !== 'tool-called' && event.type !== 'tool-result' && event.type !== 'tool-denied')
    return {}
  if (!state.parked.has(event.callId)) return {}

  const parked = new Map(state.parked)
  parked.delete(event.callId)
  return { parked }
}

const promptPatch = (event: Event): Patch => {
  if (event.type === 'user-said') {
    return { lastUserSaidSeq: event.seq, cutShortSincePrompt: false }
  }
  if (event.type === 'nudge') return { cutShortSincePrompt: false }
  if (event.type === 'assistant-said') {
    return {
      lastAssistant: event,
      ...(carriesInterruption(event) ? { cutShortSincePrompt: true } : {}),
    }
  }
  return carriesInterruption(event) ? { cutShortSincePrompt: true } : {}
}

const locationPatch = (event: Event): Patch => {
  if (event.type === 'worktree-entered') return { worktree: activeWorktreeOf([event]) }
  if (event.type === 'worktree-exited') {
    return {
      worktree: undefined,
      ...(event.returnTo === undefined ? {} : { home: event.returnTo }),
    }
  }
  if (event.type === 'directory-changed') return { worktree: undefined, home: event.path }
  if (event.type === 'location-changed') {
    return { worktree: undefined, home: event.cwd }
  }
  return {}
}

export function stepLoopState(state: LoopState, event: Event): LoopState {
  const next: LoopState = {
    ...state,
    empty: false,
    lastSeq: event.seq,
    ...(isTurnTaking(event) ? { lastTurnType: event.type } : {}),
    ...callsPatch(state, event),
    ...parkedPatch(state, event),
    ...approvalsPatch(state, event),
    ...promptPatch(event),
    ...locationPatch(event),
  }
  return next
}

export const loopStateOf = ({ events }: { events: readonly Event[] }): LoopState =>
  events.reduce(stepLoopState, initialLoopState())

const pendingCallOf = (event: EventOfType<'tool-called'>): PendingCall => ({
  callId: event.callId,
  name: event.name,
  input: event.input,
  ordinal: event.ordinal,
  runId: event.runId,
  threadId: event.threadId,
})

export const pendingCallsOf = (state: LoopState): PendingCall[] => state.pending.map(pendingCallOf)

export const settleablePendingOf = (state: LoopState): PendingCall[] =>
  state.pending.filter((call) => !state.parked.has(call.callId)).map(pendingCallOf)

export function openParkedCallOfState(state: LoopState): CallId | undefined {
  let earliest: { callId: CallId; seq: number } | undefined
  for (const [callId, seq] of state.parked) {
    if (earliest === undefined || seq < earliest.seq) earliest = { callId, seq }
  }
  return earliest?.callId
}

export const crashedCallsOf = (state: LoopState): PendingCall[] =>
  state.dispatched.size === 0
    ? []
    : state.pending
        .filter((call) => state.dispatched.has(call.callId) && !state.parked.has(call.callId))
        .map(pendingCallOf)

export function outstandingApprovalOf(state: LoopState): CallId | undefined {
  let earliest: { callId: CallId; seq: number } | undefined
  for (const [callId, seq] of state.approvals) {
    if (earliest === undefined || seq < earliest.seq) earliest = { callId, seq }
  }
  return earliest?.callId
}

export const awaitsReplyOf = (state: LoopState): boolean =>
  state.lastTurnType !== undefined && state.lastTurnType !== 'assistant-said'

export const activeWorktreeOfState = (state: LoopState): ActiveWorktree | undefined =>
  state.worktree

export const homeDirectoryOfState = ({
  state,
  launchDirectory,
}: {
  state: LoopState
  launchDirectory: string
}): string => state.home ?? launchDirectory

export const projectDirectoryOfState = ({
  state,
  launchDirectory,
}: {
  state: LoopState
  launchDirectory: string
}): string => state.worktree?.path ?? homeDirectoryOfState({ state, launchDirectory })

export function resumePlanOf(state: LoopState): ResumePlan {
  if (state.empty) return { kind: EResume.Nothing }
  if (outstandingApprovalOf(state) !== undefined) {
    return { kind: EResume.Blocked, reason: APPROVAL_WAITING }
  }
  if (state.parked.size > 0) return { kind: EResume.Blocked, reason: TOOL_PARKED_WAITING }
  if (state.pending.length > 0) return { kind: EResume.Continue, nudge: false }
  if (awaitsReplyOf(state)) {
    return { kind: EResume.Continue, nudge: state.cutShortSincePrompt }
  }
  if (state.lastAssistant?.interrupted !== true) return { kind: EResume.Nothing }
  return { kind: EResume.Nudge, interrupted: state.lastAssistant }
}

export const resumeDraftsOf = (state: LoopState): readonly EventDraft[] =>
  nudgeDraftsFor(resumePlanOf(state))

export const isResumableOf = (state: LoopState): boolean => isResumablePlan(resumePlanOf(state))
