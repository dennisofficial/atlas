import { EAgentStatus, toThreadId } from '@dltech/atlas-core'
import { EChecksState, EPullRequestState, type AgentSnapshot } from '@dltech/atlas-harness'
import { describe, expect, it } from 'bun:test'

import { withCrew } from '../sidebar-model'
import { IDLE_SIDEBAR } from '../sidebar-model'
import {
  isAgentLive,
  subagentLabel,
  subagentRows,
  subagentTitle,
  subagentValue,
} from '../subagent-row'

const PARENT = toThreadId('thr_parent')

const CHILD = toThreadId('thr_child')

const STARTED = '2026-01-01T00:00:00.000Z'

const NOW = Date.parse('2026-01-01T00:01:04.000Z')

const snapshot = (over: Partial<AgentSnapshot> = {}): AgentSnapshot => ({
  agentId: CHILD,
  spawnedBy: PARENT,
  agentType: 'explore',
  intent: 'vault audit',
  status: EAgentStatus.Running,
  turns: 0,
  toolCalls: 0,
  lastTool: undefined,
  startedAt: STARTED,
  endedAt: undefined,
  ...over,
})

const valueOf = (over: Partial<AgentSnapshot> = {}): string =>
  subagentValue({ snapshot: snapshot(over), now: NOW })

describe('the title of a row', () => {
  it('is the whole intent, not its first three words', () => {
    expect(subagentTitle(snapshot({ intent: 'Fix the serve wake path on reconnect' }))).toBe(
      'Fix the serve wake path on reconnect',
    )
  })

  it('folds an intent written across lines onto one line', () => {
    expect(subagentTitle(snapshot({ intent: 'audit\n  the   vault' }))).toBe('audit the vault')
  })

  it('names an untitled child by its type', () => {
    expect(subagentTitle(snapshot({ intent: '  ' }))).toBe('explore')
  })

  it('keeps the three-word handle for the places that still use it', () => {
    expect(subagentLabel(snapshot({ intent: 'one two three four five' }))).toBe('one two three')
  })
})

describe('the right-hand value of a row', () => {
  it('reads a running child as how long it has been going', () => {
    expect(valueOf()).toBe('1m 4s')
  })

  it('reads a held child as what holds it', () => {
    expect(valueOf({ waitingOn: 'bash "bun test"' })).toBe('bash "bun test"')
  })

  it('clips a long hold so the title keeps room', () => {
    expect(
      valueOf({ waitingOn: 'bash "bun run build --filter everything"' }).length,
    ).toBeLessThanOrEqual(18)
  })

  it.each([
    [EAgentStatus.Blocked, 'approve?'],
    [EAgentStatus.Paused, 'paused'],
    [EAgentStatus.Finished, 'done'],
    [EAgentStatus.Failed, 'failed'],
    [EAgentStatus.Stopped, 'stopped'],
  ])('reads %s as %s', (status, word) => {
    expect(valueOf({ status })).toBe(word)
  })

  it('never lets a hold outrank a settled ending', () => {
    expect(valueOf({ status: EAgentStatus.Finished, waitingOn: 'bash "x"' })).toBe('done')
  })

  it('says running when the start cannot be read', () => {
    expect(valueOf({ startedAt: 'not a stamp' })).toBe('running')
  })

  it('never reads earlier than the child started', () => {
    expect(subagentValue({ snapshot: snapshot(), now: Date.parse(STARTED) - 5_000 })).toBe('0s')
  })
})

describe('whether an agent is live', () => {
  it('counts running and blocked, and nothing else', () => {
    expect(isAgentLive({ status: EAgentStatus.Running })).toBe(true)
    expect(isAgentLive({ status: EAgentStatus.Blocked })).toBe(true)
    for (const status of [
      EAgentStatus.Finished,
      EAgentStatus.Failed,
      EAgentStatus.Stopped,
      EAgentStatus.Paused,
    ])
      expect(isAgentLive({ status })).toBe(false)
  })
})

describe('deriving rows from snapshots', () => {
  it('carries only what the one-line row draws', () => {
    const [row] = subagentRows({ snapshots: [snapshot()], now: NOW })

    expect(row).toEqual({
      id: CHILD,
      name: 'vault audit',
      agentType: 'explore',
      status: EAgentStatus.Running,
      waitingOn: undefined,
      value: '1m 4s',
      selected: false,
      pullRequest: undefined,
    })
  })

  it('marks the row being viewed', () => {
    const rows = subagentRows({ snapshots: [snapshot()], now: NOW, viewing: CHILD })

    expect(rows[0]?.selected).toBe(true)
  })

  it('hands a teammate its pull request and a sub-agent none', () => {
    const badge = {
      label: '#1421',
      url: 'https://example.test/1421',
      state: EPullRequestState.Open,
      checks: EChecksState.None,
      pollBacked: false,
    }
    const rows = subagentRows({
      snapshots: [
        snapshot({ agentId: toThreadId('thr_mate'), agentType: 'teammate' }),
        snapshot({ agentId: toThreadId('thr_sub') }),
      ],
      now: NOW,
      pullRequestOf: () => badge,
    })

    expect(rows[0]?.pullRequest).toEqual(badge)
    expect(rows[1]?.pullRequest).toBeUndefined()
  })
})

describe('merging the crew into a sidebar', () => {
  it('leaves a sidebar untouched when there is no crew to add', () => {
    expect(withCrew({ model: IDLE_SIDEBAR, subagents: [] })).toBe(IDLE_SIDEBAR)
  })

  it('adds the rows when there are some', () => {
    const subagents = subagentRows({ snapshots: [snapshot()], now: NOW })

    expect(withCrew({ model: IDLE_SIDEBAR, subagents }).subagents).toBe(subagents)
  })
})
