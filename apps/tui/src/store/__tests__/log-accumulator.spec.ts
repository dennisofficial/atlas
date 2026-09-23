import { describe, expect, it } from 'bun:test'

import {
  EClassifierMode,
  EDecision,
  EExecutionLocation,
  EJudgment,
  ETriage,
  EWorktreeExit,
  activeWorktreeOf,
  estimateEventTokens,
  homeDirectoryOf,
  planFromEvents,
  repoOf,
  treeMutationsOf,
  EToolEffect,
  type Event,
  type EventDraft,
} from '@dltech/atlas-core'
import { PLAN_TOOL_NAME } from '@dltech/atlas-core'

import {
  cloneLogAccumulator,
  emptyLogAccumulator,
  foldLogEvent,
  foldLogEvents,
} from '../log-accumulator'
import { sidebarFoldFrom, sidebarFoldOf } from '../sidebar-model'
import { log } from './fixture'
import { callId, called, result } from './tool-fixture'

const effects = (name: string) => (name === 'Read' ? EToolEffect.Read : undefined)

const varied = (): readonly Event[] =>
  log([
    { type: 'user-said', text: 'build me a thing' },
    called({ n: 1, name: 'bash', input: { command: 'ls' } }),
    result({ n: 1, name: 'bash', output: { stdout: 'ok' } }),
    {
      type: 'classifier-judged',
      callId: callId(1),
      mode: EClassifierMode.Gate,
      triage: ETriage.Consult,
      judgment: EJudgment.Risky,
      dimensions: ['destructive'],
      signalIds: [],
      reason: 'rm -rf adjacent',
      consulted: false,
      wouldAsk: true,
      elapsedMs: 12,
    },
    {
      type: 'permission-granted',
      grantId: 'grant-1',
      dimensions: ['destructive'],
      scope: 'thread' as never,
      subject: 'bash',
      reason: 'operator allowed',
    },
    { type: 'worktree-entered', path: '/repo/.atlas/worktrees/feat', branch: 'dennis/feat' },
    { type: 'directory-changed', path: '/repo/packages', repo: 'repo' },
    {
      type: 'classifier-judged',
      callId: callId(2),
      mode: EClassifierMode.Gate,
      triage: ETriage.Auto,
      judgment: EJudgment.Safe,
      dimensions: ['reads-files'],
      signalIds: [],
      reason: 'benign',
      consulted: true,
      elapsedMs: 4,
    },
    called({ n: 3, name: PLAN_TOOL_NAME, input: { tasks: [{ text: 'step one', status: 'pending' }] } }),
    result({ n: 3, name: PLAN_TOOL_NAME, output: {} }),
    { type: 'user-said', text: 'keep going' },
    { type: 'permission-revoked', grantId: 'grant-1' },
    { type: 'worktree-exited', path: '/repo/.atlas/worktrees/feat', action: EWorktreeExit.Keep, returnTo: '/repo' },
    { type: 'location-changed', from: EExecutionLocation.Host, to: EExecutionLocation.Docker },
    called({ n: 4, name: 'Read', input: { path: '/x' } }),
    result({ n: 4, name: 'Read', output: 'contents' }),
  ])

describe('the log accumulator', () => {
  it('lands on the same sidebar fold as the whole-array read', () => {
    const events = varied()

    expect(sidebarFoldFrom(foldLogEvents({ events, effects }))).toEqual(sidebarFoldOf(events))
  })

  it('lands on the same tallies as the whole-array reads', () => {
    const events = varied()
    const acc = foldLogEvents({ events, effects })

    expect(acc.tokens).toBe(estimateEventTokens(events))
    expect(acc.treeMutations).toBe(treeMutationsOf({ events, effects }))
    expect(acc.plan).toEqual(planFromEvents(events))
    expect(acc.worktree).toEqual(activeWorktreeOf(events))
    expect(acc.home ?? '/launch').toBe(homeDirectoryOf({ events, launchDirectory: '/launch' }))
    expect(acc.repo ?? 'launch-repo').toBe(repoOf({ events, launchRepo: 'launch-repo' }))
  })

  it('folds a log in two halves to the same place as all at once', () => {
    const events = varied()
    const whole = foldLogEvents({ events, effects })

    const base = foldLogEvents({ events: events.slice(0, 7), effects })
    const continued = cloneLogAccumulator(base)
    for (const event of events.slice(7)) foldLogEvent({ acc: continued, event, effects })

    expect(sidebarFoldFrom(continued)).toEqual(sidebarFoldFrom(whole))
    expect(continued.tokens).toBe(whole.tokens)
    expect(continued.treeMutations).toBe(whole.treeMutations)
    expect(continued.plan).toEqual(whole.plan)
    expect(continued.worktree).toEqual(whole.worktree)
    expect(continued.home).toBe(whole.home)
    expect(continued.repo).toBe(whole.repo)
  })

  it('answers an edited plan input the way the whole-array read does', () => {
    const drafts: EventDraft[] = [
      called({ n: 1, name: PLAN_TOOL_NAME, input: { tasks: [{ text: 'original', status: 'pending' }] } }),
      {
        type: 'approval-answered',
        callId: callId(1),
        decision: EDecision.Allow,
        editedInput: { tasks: [{ text: 'edited', status: 'pending' }] },
      },
      result({ n: 1, name: PLAN_TOOL_NAME, output: {} }),
    ]
    const events = log(drafts)

    expect(foldLogEvents({ events, effects }).plan).toEqual(planFromEvents(events))
    expect(planFromEvents(events).map((task) => task.text)).toEqual(['edited'])
  })

  it('forgets a pending plan call its result never confirms', () => {
    const events = log([
      called({ n: 1, name: PLAN_TOOL_NAME, input: { tasks: [{ text: 'draft', status: 'pending' }] } }),
    ])
    const acc = foldLogEvents({ events, effects })

    expect(acc.plan).toEqual([])
    expect(acc.pendingPlanInputs.size).toBe(1)
  })

  it('starts empty on every front', () => {
    const acc = emptyLogAccumulator()

    expect(sidebarFoldFrom(acc)).toEqual(sidebarFoldOf([]))
    expect(acc.tokens).toBe(0)
    expect(acc.treeMutations).toBe(0)
    expect(acc.worktree).toBeUndefined()
    expect(acc.home).toBeNull()
    expect(acc.repo).toBeNull()
  })
})
