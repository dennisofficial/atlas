import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'

import { log } from '../../assembly/__tests__/log-fixture'
import { EDecision, EWorktreeExit, type EventDraft } from '../../events/body'
import type { Event } from '../../events/envelope'
import { toCallId } from '../../events/ids'
import {
  awaitsReply,
  crashedCalls,
  outstandingApproval,
  pendingCalls,
} from '../../events/projections'
import { EResume, isResumable, resumeDrafts, resumePlan } from '../../events/resume-plan'
import { EExecutionLocation } from '../../execution/location'
import { EShellStatus } from '../../shells/status'
import { activeWorktreeOf, homeDirectoryOf, projectDirectoryOf } from '../../workspace/worktree'
import {
  activeWorktreeOfState,
  awaitsReplyOf,
  crashedCallsOf,
  homeDirectoryOfState,
  initialLoopState,
  isResumableOf,
  type LoopState,
  loopStateOf,
  outstandingApprovalOf,
  pendingCallsOf,
  projectDirectoryOfState,
  resumeDraftsOf,
  resumePlanOf,
  stepLoopState,
} from '../loop-state'

const launchDirectory = '/launch'

const callId = fc.constantFrom(...['a', 'b', 'c'].map(toCallId))
const interrupted = fc.constantFrom(true, false, undefined)
const directory = fc.constantFrom('/one', '/two', '/three')
const optionalDirectory = fc.option(directory, { nil: undefined })

const drafts: fc.Arbitrary<EventDraft> = fc.oneof(
  fc.record({ id: callId, ordinal: fc.nat(5) }).map(
    ({ id, ordinal }): EventDraft => ({
      type: 'tool-called',
      callId: id,
      name: 'bash',
      input: { ordinal },
      ordinal,
    }),
  ),
  fc.record({ id: callId, interrupted }).map(
    ({ id, interrupted }): EventDraft => ({
      type: 'tool-result',
      callId: id,
      name: 'bash',
      output: 'ok',
      interrupted,
    }),
  ),
  fc.record({ id: callId, interrupted }).map(
    ({ id, interrupted }): EventDraft => ({
      type: 'tool-denied',
      callId: id,
      name: 'bash',
      reason: 'no',
      interrupted,
    }),
  ),
  callId.map((id): EventDraft => ({ type: 'tool-dispatched', callId: id, name: 'bash' })),
  callId.map((id): EventDraft => ({ type: 'approval-requested', callId: id, reason: 'why' })),
  callId.map(
    (id): EventDraft => ({ type: 'approval-answered', callId: id, decision: EDecision.Allow }),
  ),
  fc.constant<EventDraft>({ type: 'user-said', text: 'hello' }),
  interrupted.map(
    (value): EventDraft => ({ type: 'assistant-said', parts: [], interrupted: value }),
  ),
  fc.constant<EventDraft>({ type: 'nudge', text: 'n', lifetimeSteps: 1 }),
  fc.record({ path: directory, adopted: interrupted }).map(
    ({ path, adopted }): EventDraft => ({
      type: 'worktree-entered',
      path,
      branch: 'feature',
      base: 'main',
      adopted,
    }),
  ),
  fc.record({ path: directory, returnTo: optionalDirectory }).map(
    ({ path, returnTo }): EventDraft => ({
      type: 'worktree-exited',
      path,
      action: EWorktreeExit.Keep,
      returnTo,
    }),
  ),
  directory.map((path): EventDraft => ({ type: 'directory-changed', path })),
  optionalDirectory.map(
    (cwd): EventDraft => ({
      type: 'location-changed',
      from: EExecutionLocation.Host,
      to: EExecutionLocation.Cloud,
      cwd,
    }),
  ),
  fc.constant<EventDraft>({
    type: 'background-shell-ended',
    shellId: 'shell',
    command: 'true',
    status: EShellStatus.Exited,
    output: '',
    droppedCharacters: 0,
    remainingCharacters: 0,
  }),
)

const sequences = fc.array(drafts, { maxLength: 60, size: 'max' }).map(log)

const foldPrefixes = (events: readonly Event[]): LoopState[] => {
  const states = [initialLoopState()]
  for (const event of events) {
    const last = states.at(-1)
    if (last === undefined) throw new Error('no state')
    states.push(stepLoopState(last, event))
  }
  return states
}

const expectDerivationsMatch = ({
  state,
  prefix,
}: {
  state: LoopState
  prefix: readonly Event[]
}) => {
  expect(pendingCallsOf(state)).toEqual(pendingCalls(prefix))
  expect(crashedCallsOf(state)).toEqual(crashedCalls(prefix))
  expect(outstandingApprovalOf(state)).toEqual(outstandingApproval(prefix))
  expect(awaitsReplyOf(state)).toEqual(awaitsReply(prefix))
  expect(activeWorktreeOfState(state)).toEqual(activeWorktreeOf(prefix))
  expect(homeDirectoryOfState({ state, launchDirectory })).toEqual(
    homeDirectoryOf({ events: prefix, launchDirectory }),
  )
  expect(projectDirectoryOfState({ state, launchDirectory })).toEqual(
    projectDirectoryOf({ events: prefix, launchDirectory }),
  )
  expect(resumePlanOf(state)).toEqual(resumePlan(prefix))
  expect(resumeDraftsOf(state)).toEqual(resumeDrafts(prefix))
  expect(isResumableOf(state)).toEqual(isResumable(prefix))
  expect(state.lastSeq).toEqual(prefix.at(-1)?.seq)
  expect(state.lastUserSaidSeq).toEqual(prefix.findLast((event) => event.type === 'user-said')?.seq)
}

describe('LoopState against the whole-log folds', () => {
  it('matches every derivation after every prefix of random logs', () => {
    fc.assert(
      fc.property(sequences, (events) => {
        foldPrefixes(events).forEach((state, length) => {
          expectDerivationsMatch({ state, prefix: events.slice(0, length) })
        })
      }),
      { numRuns: 1000 },
    )
  })

  it('loopStateOf equals the stepped fold', () => {
    fc.assert(
      fc.property(sequences, (events) => {
        expect(loopStateOf({ events })).toEqual(foldPrefixes(events).at(-1) ?? initialLoopState())
      }),
      { numRuns: 300 },
    )
  })

  it('shares every collection an event does not touch', () => {
    const [first, second] = log([
      { type: 'tool-called', callId: toCallId('a'), name: 'bash', input: 1, ordinal: 0 },
      { type: 'checkout-observed', path: '/y', branch: null, detached: false },
    ])
    if (first === undefined || second === undefined) throw new Error('no events')
    const state = stepLoopState(initialLoopState(), first)
    const next = stepLoopState(state, second)
    expect(next.pending).toBe(state.pending)
    expect(next.approvals).toBe(state.approvals)
    expect(next.dispatched).toBe(state.dispatched)
    expect(next.lastSeq).toBe(2)
  })
})

describe('LoopState named cases', () => {
  const fold = (value: readonly EventDraft[]) => loopStateOf({ events: log(value) })
  const id = toCallId('bash_1')

  it('settles the latest open call when a provider reuses an id', () => {
    const state = fold([
      { type: 'tool-called', callId: id, name: 'bash', input: 1, ordinal: 0 },
      { type: 'tool-called', callId: id, name: 'bash', input: 2, ordinal: 0 },
      { type: 'tool-result', callId: id, name: 'bash', output: 'ok' },
    ])
    expect(pendingCallsOf(state).map((call) => call.input)).toEqual([1])
  })

  it('keeps the fresh call pending and not crashed after a reused id settles an old one', () => {
    const state = fold([
      { type: 'tool-called', callId: id, name: 'bash', input: 1, ordinal: 0 },
      { type: 'tool-dispatched', callId: id, name: 'bash' },
      { type: 'tool-result', callId: id, name: 'bash', output: 'ok' },
      { type: 'tool-called', callId: id, name: 'bash', input: 2, ordinal: 0 },
    ])
    expect(pendingCallsOf(state).map((call) => call.input)).toEqual([2])
    expect(crashedCallsOf(state)).toEqual([])
  })

  it('nudges an interrupted reply and stops once the nudge has been sent', () => {
    const interruptedReply: EventDraft[] = [
      { type: 'user-said', text: 'go' },
      { type: 'assistant-said', parts: [], interrupted: true },
    ]
    expect(resumePlanOf(fold(interruptedReply)).kind).toBe(EResume.Nudge)
    expect(resumeDraftsOf(fold(interruptedReply))).toHaveLength(1)

    const nudged = fold([...interruptedReply, { type: 'nudge', text: 'n', lifetimeSteps: 1 }])
    expect(resumePlanOf(nudged)).toEqual({ kind: EResume.Continue, nudge: false })
    expect(resumeDraftsOf(nudged)).toEqual([])
  })
})
