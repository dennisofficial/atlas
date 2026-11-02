import { describe, expect, it } from 'bun:test'

import { EAgentDisplay } from '@dltech/atlas-ui/ai/agent-status'
import type { WireThread } from '@dltech/atlas-wire/web'

import {
  groupTeammates,
  hasAttentionTeammate,
  teammateCountLabel,
  teammateDisplay,
} from '../teammate-display'
import { agoIso, threadOf } from './fixtures'

type Status = NonNullable<WireThread['status']>

const teammateWith = (id: string, status: Partial<Status>): WireThread =>
  threadOf({
    id,
    status: {
      working: false,
      awaiting: null,
      lastOutcome: null,
      podState: 'running',
      lastAssistantSeq: 0,
      ...status,
    } as Status,
  })

describe('teammateDisplay', () => {
  it.each<[Partial<Status>, EAgentDisplay]>([
    [{ working: true }, EAgentDisplay.Running],
    [{ awaiting: 'approval' }, EAgentDisplay.NeedsApproval],
    [{ podState: 'booting' }, EAgentDisplay.StartingSandbox],
    [{ podState: 'failed' }, EAgentDisplay.Failed],
    [{ lastOutcome: 'failed' }, EAgentDisplay.Failed],
    [{ lastOutcome: 'completed' }, EAgentDisplay.Done],
    [{ lastOutcome: 'stopped' }, EAgentDisplay.Done],
    [{}, EAgentDisplay.Paused],
  ])('maps %o to %s', (status, expected) => {
    expect(teammateDisplay(teammateWith('t', status))).toBe(expected)
  })

  it('treats a thread without status as paused', () => {
    expect(teammateDisplay(threadOf({ id: 't' }))).toBe(EAgentDisplay.Paused)
  })
})

describe('groupTeammates', () => {
  it('puts attention first among active teammates and folds archived ones into done', () => {
    const archived = { ...teammateWith('archived', {}), archivedAt: agoIso(1) }
    const { active, done } = groupTeammates([
      teammateWith('run', { working: true }),
      archived,
      teammateWith('blocked', { awaiting: 'input' }),
      teammateWith('idle', {}),
      teammateWith('failed', { lastOutcome: 'failed' }),
      teammateWith('finished', { lastOutcome: 'completed' }),
    ])
    expect(active.map((teammate) => teammate.id)).toEqual([
      'blocked',
      'failed',
      'run',
      'idle',
      'finished',
    ])
    expect(done.map((teammate) => teammate.id)).toEqual(['archived'])
  })
})

describe('hasAttentionTeammate', () => {
  it('is true for a failed or approval-blocked teammate', () => {
    expect(hasAttentionTeammate([teammateWith('a', { lastOutcome: 'failed' })])).toBe(true)
    expect(hasAttentionTeammate([teammateWith('a', { awaiting: 'approval' })])).toBe(true)
  })

  it('is false for running, paused and done teammates', () => {
    expect(
      hasAttentionTeammate([
        teammateWith('a', { working: true }),
        teammateWith('b', {}),
        teammateWith('c', { lastOutcome: 'completed' }),
      ]),
    ).toBe(false)
  })
})

describe('teammateCountLabel', () => {
  it('pluralises', () => {
    expect(teammateCountLabel(1)).toBe('1 teammate')
    expect(teammateCountLabel(6)).toBe('6 teammates')
  })
})
